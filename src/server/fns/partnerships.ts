import { badRequest, conflict, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../db'
import { letterLogo } from '../logo'
import { requireFeature } from '../features'
import { searchAny } from '../searchTerm'
import { anyOf, anyTag } from '../filterSql'
import {
  applications,
  eois,
  partnerships,
  partnershipEvents,
  programmes,
  roundProgrammes,
} from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { facetBy, facetByMany, type FacetOption } from '../../lib/facets'
import { clampPage, PAGE_SIZE } from '../../lib/pagination'
import { runDueDiligence } from '../dueDiligence/run'
import { enqueue } from '../pipelineQueue'
import { scorePartnership } from '../partnerships/score'
import { scoreApplication } from '../applications/score'
import { sourcedApplicationValues } from '../sourcing/application'
import { organisationHistory } from '../partnerships/history'
import { sendAwardLetterEmail } from '../../lib/email'
import { tidyRegisteredName } from '../../lib/organisationName'
import { withInviteRef } from '../../lib/sourcing/inviteRef'
import { renderOutreach } from '../../lib/sourcing/outreach'
import {
  ArchivePartnershipSchema,
  LinkPartnershipApplicationSchema,
  PartnershipActionSchema,
  PartnershipNoteSchema,
  ProgressPartnershipSchema,
  SavePartnershipSchema,
  SendPartnershipEmailSchema,
} from '../../lib/validators/partnership'
import {
  assessmentGaps,
  canTransition,
  PARTNERSHIP_STATUSES,
  PARTNERSHIP_ACTION_META,
  PARTNERSHIP_STATUS_META,
  PARTNERSHIP_TAB_IDS,
  statusesForTab,
  type PartnershipAction,
  type PartnershipStatus,
  type PartnershipTab,
} from '../../lib/partnerships/status'

// ─── Partnerships: the pipeline before an application ────────────────────────
//
// **Tenancy here does not go through `visibleRoundProgrammeIds`, and that is the one
// thing to know before touching this file.** Every other list in the app is scoped by
// the round-programmes a caller can see, because every other record hangs off one. A
// partnership does not — it exists before there is a round to hang it on — so its
// tenancy is `partnerships.client_id`, filtered directly on every read and re-checked
// with `assertClientAccess` on every write. A query added here that forgets it is not
// caught by the shared helper the way a missing scope elsewhere would be.
//
// The second rule is that **nothing in this module moves money or writes to
// `audit_log`.** A partnership has no budget line and no commitment; `amount_sought` is
// a value somebody PROPOSED. The record of what happened lives in
// `partnership_events`, which answers "how do we know these people" — a different
// question from the audit log's "who did this to a grant", and one that starts before
// the foundation has done anything at all.
//
// The one place a partnership touches the money is `progressPartnership`, and it does it
// by ceasing to be one: it creates an APPLICATION, in a round somebody picks, and every
// figure from then on is read off that row by the code that already reads applications.

/** The order the list arrives in when nothing has been clicked — see `APPLICATIONS_DEFAULT_SORT`. */
export const PARTNERSHIPS_DEFAULT_SORT = { by: 'logged', dir: 'desc' } as const

export const PARTNERSHIP_SORT_KEYS = [
  'organisation',
  'programme',
  'source',
  'status',
  'dueDiligence',
  'score',
  'amount',
  'logged',
] as const
export type PartnershipSortKey = (typeof PARTNERSHIP_SORT_KEYS)[number]

const FiltersSchema = z
  .object({
    tab: z.enum(PARTNERSHIP_TAB_IDS as [PartnershipTab, ...PartnershipTab[]]).optional(),
    // The list's Status pill. Absent (with no tab) is every live partnership, which is
    // what the screen shows since its tabs went (feedback, 2026-10-05).
    status: z.array(z.enum(PARTNERSHIP_STATUSES)).min(1).max(10).optional(),
    // Every pill takes several values, OR'd within one — see `lib/filterSelection`.
    programmeId: z.array(z.string()).min(1).max(500).optional(),
    source: z.array(z.string()).min(1).max(500).optional(),
    tag: z.array(z.string()).min(1).max(500).optional(),
    q: z.string().optional(),
    /** Archived rows are out of every tab; this is the only way to see them. */
    archived: z.boolean().optional(),
    sortBy: z.enum(PARTNERSHIP_SORT_KEYS).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().positive().optional(),
  })
  .optional()

// The list row, in one place: the columns the table draws off the joined programme and
// off whatever the invitation turned into. Extracted as a function so the row TYPE can
// be inferred from the query rather than restated beside it and left to drift.
const LIST_WITH = {
  programme: { columns: { id: true, name: true, colour: true, tags: true } },
  roundProgramme: { columns: { id: true }, with: { round: { columns: { name: true } } } },
  application: { columns: { id: true, status: true } },
} as const

function listRows(where: SQL | undefined, orderBy: SQL[], offset: number) {
  return getDb().query.partnerships.findMany({
    where,
    with: LIST_WITH,
    orderBy,
    offset,
    limit: PAGE_SIZE,
  })
}

export type PartnershipRow = Awaited<ReturnType<typeof listRows>>[number]

/**
 * The pipeline list.
 *
 * Tab counts are computed from the same base as the rows but WITHOUT the tab filter, so
 * each tab reflects the programme/source/theme/search you have set — a count that
 * ignored the active filters would send you to an empty tab. Facets are computed before
 * the transient filters for the reason `lib/facets` gives: a filter that pruned the
 * other filters' options lets you corner yourself.
 */
export const listPartnerships = createServerFn({ method: 'GET' })
  .validator(FiltersSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireAuthUser()
    const filters = data ?? {}
    const empty = {
      items: [] as PartnershipRow[],
      total: 0,
      page: 1,
      pageSize: PAGE_SIZE,
      tabCounts: { to_action: 0, awaiting: 0, closed: 0 },
      portfolio: { live: 0, toAction: 0 },
      archivedCount: 0,
      facets: {
        programmes: [] as FacetOption[],
        sources: [] as FacetOption[],
        themes: [] as FacetOption[],
      },
    }
    // A superadmin has no client of their own, and this list is one foundation's
    // pipeline — there is no cross-tenant version of it to fall back to (the same
    // reasoning `digestWindow` uses). They see nothing here rather than everything.
    if (!user.clientId) return empty

    const db = getDb()
    const tab: PartnershipTab | undefined = filters.tab
    const archived = filters.archived === true

    // The tenancy filter, and the archive line. Both are on every query below,
    // including the counts and the facets.
    const scope = and(
      eq(partnerships.clientId, user.clientId),
      archived ? sql`${partnerships.archivedAt} is not null` : isNull(partnerships.archivedAt),
    )

    // Everything except the tab, so the tab counts reflect the other filters.
    //
    // The tab counts are as far as the filters reach upward. The header line above them
    // ("6 live · 2 waiting on you") is counted over `scope` alone — see `portfolio`
    // below — because it sits above every control on the screen, and a control narrows
    // only what is below it.
    const baseWhere = and(
      scope,
      anyOf(partnerships.programmeId, filters.programmeId),
      anyOf(partnerships.source, filters.source),
      anyTag(partnerships.tags, filters.tag),
      // Name, registration number, or where the work would be: the three things
      // somebody types when they half-remember an organisation.
      searchAny(
        filters.q,
        partnerships.organisationName,
        partnerships.charityNumber,
        partnerships.companyNumber,
        partnerships.deliveryArea,
      ),
    )

    // The archive is not a pipeline, so it has no tabs and takes no tab filter. Without
    // this the default tab ("To action") is applied to a set of rows that by definition
    // have nobody waiting on them, and the archive renders empty under a header
    // stating how many things are in it.
    const where = and(
      archived || !tab
        ? baseWhere
        : and(baseWhere, inArray(partnerships.status, statusesForTab(tab))),
      filters.status ? inArray(partnerships.status, filters.status) : undefined,
    )

    const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC'
    const sortExpr = (() => {
      switch (filters.sortBy) {
        case 'organisation':
          return sql`lower(${partnerships.organisationName}) ${sql.raw(dir)}`
        case 'source':
          return sql`lower(${partnerships.source}) ${sql.raw(dir)} NULLS LAST`
        case 'logged':
          return sql`${partnerships.createdAt} ${sql.raw(dir)}`
        // Unscored rows last either way, as on Applications.
        case 'score':
          return sql`${partnerships.custodianScore} ${sql.raw(dir)} NULLS LAST`
        case 'amount':
          return sql`${partnerships.amountSought} ${sql.raw(dir)} NULLS LAST`
        // Pipeline order, not alphabetical: a status column sorted A–Z puts "Declined"
        // above "EOI received", which is the opposite of useful.
        case 'status':
          return sql`CASE ${partnerships.status} WHEN 'eoi_received' THEN 0 WHEN 'prospective' THEN 1 WHEN 'eoi_issued' THEN 2 WHEN 'invited' THEN 3 WHEN 'applied' THEN 4 ELSE 5 END ${sql.raw(dir)}`
        // Worst first, as the applications list bands it — the same CASE, so a warning
        // sorts to the same end of both tables.
        case 'dueDiligence':
          return sql`CASE ${partnerships.dueDiligenceStatus} WHEN 'blocked' THEN 0 WHEN 'warning' THEN 1 WHEN 'review' THEN 2 WHEN 'clear' THEN 3 ELSE 4 END ${sql.raw(dir)}`
        default:
          return null
      }
    })()

    // Programme is not a column on this table — it is a join — so it cannot be one of
    // the CASE expressions above and is sorted after the rows are fetched. Everything
    // else is ordered in Postgres.
    const orderBy = !sortExpr
      ? [desc(partnerships.createdAt)]
      : filters.sortBy === PARTNERSHIPS_DEFAULT_SORT.by
        ? [sortExpr]
        : [sortExpr, desc(partnerships.createdAt)]

    const page = clampPage(filters.page, Number.MAX_SAFE_INTEGER)

    const [rows, totals, statusRows, portfolioRows, facetRows, archivedRows] = await Promise.all([
      listRows(where, orderBy, (page - 1) * PAGE_SIZE),
      db.select({ total: count() }).from(partnerships).where(where),
      db
        .select({ status: partnerships.status, count: count() })
        .from(partnerships)
        .where(baseWhere)
        .groupBy(partnerships.status),
      // The same tally over the tenant's pipeline with no filters on it at all, for the
      // header line. Same shape as the row above so one helper reads both.
      db
        .select({ status: partnerships.status, count: count() })
        .from(partnerships)
        .where(scope)
        .groupBy(partnerships.status),
      // Facets come off the whole tenant's live pipeline, not off `baseWhere` — see
      // the module comment in `lib/facets`: options are computed before the transient
      // filters so narrowing by one can never empty the others.
      db.query.partnerships.findMany({
        where: scope,
        columns: { source: true, tags: true },
        with: { programme: { columns: { id: true, name: true } } },
      }),
      // The archive is a destination, not a tab, so its size is stated rather than
      // counted into anything.
      db
        .select({ total: count() })
        .from(partnerships)
        .where(
          and(
            eq(partnerships.clientId, user.clientId),
            sql`${partnerships.archivedAt} is not null`,
          ),
        ),
    ])

    type Tally = Record<PartnershipStatus, number | undefined>
    const tally = (rows: Array<{ status: PartnershipStatus; count: number }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r.count])) as Tally
    const counted = tally(statusRows)
    const wholePipeline = tally(portfolioRows)
    const countIn = (t: Tally, tab: PartnershipTab) =>
      statusesForTab(tab).reduce((sum, s) => sum + (t[s] ?? 0), 0)
    const countFor = (t: PartnershipTab) => countIn(counted, t)

    const items = rows
    // The one sort SQL could not do (see above).
    if (filters.sortBy === 'programme') {
      const factor = filters.sortDir === 'asc' ? 1 : -1
      items.sort(
        (a, b) => factor * (a.programme?.name ?? '').localeCompare(b.programme?.name ?? ''),
      )
    }

    return {
      items,
      total: totals[0]?.total ?? 0,
      page,
      pageSize: PAGE_SIZE,
      tabCounts: {
        to_action: countFor('to_action'),
        awaiting: countFor('awaiting'),
        closed: countFor('closed'),
      },
      /**
       * The header line's figures, over the whole pipeline — the filter row is below it
       * and must not move it. Kept separate from `tabCounts`, which are filtered on
       * purpose: a tab labelled with a number it does not open onto is worse.
       */
      portfolio: {
        live: countIn(wholePipeline, 'to_action') + countIn(wholePipeline, 'awaiting'),
        toAction: countIn(wholePipeline, 'to_action'),
      },
      archivedCount: archivedRows[0]?.total ?? 0,
      facets: {
        programmes: facetBy(facetRows, (r) =>
          r.programme ? { value: r.programme.id, label: r.programme.name } : null,
        ),
        sources: facetBy(facetRows, (r) =>
          r.source ? { value: r.source, label: r.source } : null,
        ),
        themes: facetByMany(facetRows, (r) => (r.tags ?? []).map((t) => ({ value: t, label: t }))),
      },
    }
  })

/** One partnership, its programme, what it turned into, and its whole history. */
export const getPartnership = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireAuthUser()
    const row = await getDb().query.partnerships.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: {
        programme: { columns: { id: true, name: true, colour: true } },
        roundProgramme: {
          columns: { id: true },
          with: { round: { columns: { id: true, name: true, openedAt: true, closedAt: true } } },
        },
        application: { columns: { id: true, status: true, organisationName: true } },
        createdBy: { columns: { id: true, name: true } },
        events: {
          orderBy: (e, { desc: d }) => [d(e.occurredAt), d(e.createdAt)],
          with: { actor: { columns: { id: true, name: true, image: true } } },
        },
      },
    })
    if (!row) throw notFoundError()
    assertClientAccess(user, row.clientId)

    const db = getDb()
    const [history, eoiRows, candidates, client] = await Promise.all([
      organisationHistory(row.clientId, row, row.id),
      // The expressions of interest this partner sent. The submission lives in `eois`
      // and only there; this is the link through to it.
      db
        .select({ id: eois.id, status: eois.status, createdAt: eois.createdAt })
        .from(eois)
        .where(and(eq(eois.clientId, row.clientId), eq(eois.partnershipId, row.id)))
        .orderBy(desc(eois.createdAt)),
      // Applications that might be theirs, for the one case the link is not made
      // automatically: their form did not hand `custodian_ref` back. Offered, never
      // applied: only an admin pressing the button links one.
      row.applicationId ? Promise.resolve([]) : applicationCandidates(row),
      db.query.clients.findFirst({
        where: (c, { eq }) => eq(c.id, row.clientId),
        columns: { name: true },
        with: {
          profile: {
            columns: {
              awardLetterSenderName: true,
              awardLetterReplyTo: true,
              financialYearEndMonth: true,
            },
          },
        },
      }),
    ])

    return {
      ...row,
      history,
      // For "Of which in 2026/27" on the shortlist dialog: the round's year needs it.
      financialYearEndMonth: client?.profile?.financialYearEndMonth ?? null,
      eois: eoiRows,
      applicationCandidates: candidates,
      /** What an email to this partner is sent as: see `sendPartnershipEmail`. */
      sender: {
        foundationName: client?.name ?? '',
        senderName: client?.profile?.awardLetterSenderName ?? client?.name ?? null,
        replyTo: client?.profile?.awardLetterReplyTo ?? null,
      },
    }
  })

/**
 * Applications in this foundation that carry the partner's charity or company number
 * and that no partnership points at yet. Numbers only, as in `organisationHistory`: a
 * name match would offer "St Mary's" to every St Mary's.
 */
async function applicationCandidates(p: {
  clientId: string
  charityNumber: string | null
  companyNumber: string | null
}) {
  const match = or(
    p.charityNumber ? eq(applications.charityNumber, p.charityNumber) : undefined,
    p.companyNumber ? eq(applications.companyNumber, p.companyNumber) : undefined,
  )
  if (!match) return []
  return getDb()
    .select({
      id: applications.id,
      organisationName: applications.organisationName,
      status: applications.status,
      createdAt: applications.createdAt,
      programmeName: programmes.name,
    })
    .from(applications)
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .where(
      and(
        eq(programmes.clientId, p.clientId),
        match,
        sql`not exists (select 1 from partnerships x where x.application_id = ${applications.id})`,
      ),
    )
    .orderBy(desc(applications.createdAt))
    .limit(5)
}

/**
 * Look an organisation up on the registers BEFORE it is logged.
 *
 * The first step of logging a partner: type a charity or company number, and Custodian
 * says who that is and whether the foundation has met them before. It is the same
 * `runDueDiligence` the record runs, so the name it offers is the register's own.
 *
 * Read-only: nothing is written. The save screens again from the numbers it is given,
 * rather than trusting a result the browser hands back.
 */
export const lookupOrganisation = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        charityNumber: z.string().trim().max(40).nullable(),
        companyNumber: z.string().trim().max(40).nullable(),
      })
      .refine((v) => !!(v.charityNumber || v.companyNumber), 'Enter a number to look up'),
  )
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    if (!user.clientId) throw forbidden()
    const [result, history] = await Promise.all([
      runDueDiligence({
        charityNumber: data.charityNumber,
        companyNumber: data.companyNumber,
        // Nothing to compare against yet: the name is what is being asked for.
        organisationName: null,
        amountRequested: 0,
      }),
      organisationHistory(user.clientId, data),
    ])
    const profile = result.profile
    return {
      found: !!profile?.registeredName,
      registeredName: profile?.registeredName ? tidyRegisteredName(profile.registeredName) : null,
      charityType: profile?.charityType ?? null,
      latestIncome: profile?.latestIncome ?? null,
      financialPeriodEnd: profile?.financialPeriodEnd ?? null,
      registeredSince: profile?.registeredSince ?? null,
      activities: profile?.activities ?? null,
      history,
    }
  })

// ─── Writes ──────────────────────────────────────────────────────────────────
//
// All admin-only. A trustee reads the pipeline — an introduction they made is on it,
// and it is exactly the screen a board member asks about — but who the foundation
// approaches is an executive decision, the same line `saveRound` and `createAwards`
// draw. Reads above take `requireAuthUser`; everything below takes `requireRole`.

/** Load a partnership for a write, proving the caller may act on it. */
async function forWrite(id: string, user: { role: string; clientId: string | null }) {
  const existing = await getDb().query.partnerships.findFirst({
    where: (p, { eq }) => eq(p.id, id),
  })
  if (!existing) throw notFoundError()
  assertClientAccess(user, existing.clientId)
  return existing
}

/**
 * Run the registers for a partnership's numbers. The same call `screenPartnership` makes,
 * shared so a save and the button cannot screen differently.
 */
async function screen(p: {
  charityNumber: string | null
  companyNumber: string | null
  organisationName: string
  amountSought: string | number | null
}) {
  const result = await runDueDiligence({
    charityNumber: p.charityNumber,
    companyNumber: p.companyNumber,
    organisationName: p.organisationName,
    // Zero when no value has been proposed, which makes the "% of income" check
    // unverified rather than wrong.
    amountRequested: Number(p.amountSought ?? 0),
  })
  return {
    dueDiligenceStatus: result.status,
    dueDiligenceChecks: result.checks,
    dueDiligenceCheckedAt: new Date(result.checkedAt),
    organisationProfile: result.profile,
  }
}

/** Ask for the assessment. The row must already be at `queued`. */
async function queueAssessment(partnershipId: string) {
  await enqueue({ kind: 'partnership_score', partnershipId }, () => scorePartnership(partnershipId))
}

/**
 * Create or update a partnership — the whole dialog in one call, as `saveProgramme` is.
 *
 * On create, two rows are written: the partnership and the first line of its history.
 * They go in ONE `db.batch` because they are one fact — a prospect logged with no
 * "logged" event has a timeline that begins in the middle, and the screen would have
 * nothing to say about where the relationship came from, which is the whole reason
 * somebody typed it in. (`db.transaction()` is not available on the neon-http driver;
 * see CLAUDE.md.)
 *
 * **Screening happens here, inline**, whenever there is a number and it is new or has
 * changed: it is a few seconds against the registers, the admin is watching, and a
 * record that says "not screened" beside a number it was given a moment ago reads as
 * broken. **The assessment does not**: it is 30 to 60 seconds of model time, so the row
 * is marked `queued` and the queue fills it in. Every input it needs is required by the
 * form, so a new partner is always assessed. After that an edit never re-runs it, for the
 * reason an application's edit does not (each run is a paid model call and people fix
 * several things in a row); "Re-run assessment" is the deliberate version. The one
 * exception is a row logged before the form required those inputs, still at `waiting`,
 * which is queued the first time an edit completes it.
 */
export const savePartnership = createServerFn({ method: 'POST' })
  .validator(SavePartnershipSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()

    // The round-programme must be this foundation's own. The id arrives from a browser,
    // and the assessment reads its programme's goal into a prompt. The programme is
    // taken from it, never sent separately, so the two cannot disagree.
    const roundProgramme = await db.query.roundProgrammes.findFirst({
      where: (rp, { eq }) => eq(rp.id, data.roundProgrammeId),
      columns: { id: true, programmeId: true },
      with: { programme: { columns: { clientId: true } } },
    })
    if (!roundProgramme) throw notFoundError()
    assertClientAccess(user, roundProgramme.programme.clientId)

    const values = {
      organisationName: data.organisationName,
      charityNumber: data.charityNumber,
      companyNumber: data.companyNumber,
      source: data.source,
      roundProgrammeId: roundProgramme.id,
      programmeId: roundProgramme.programmeId,
      deliveryArea: data.deliveryArea,
      contactEmail: data.contactEmail,
      amountSought: String(data.amountSought),
      proposedPurpose: data.proposedPurpose,
      proposedImpactQuantity:
        data.proposedImpactQuantity === null ? null : String(data.proposedImpactQuantity),
      updatedAt: new Date(),
    }
    const hasNumber = !!(data.charityNumber || data.companyNumber)
    const ready = assessmentGaps(values).length === 0

    if (data.id) {
      const existing = await forWrite(data.id, user)
      const numbersChanged =
        (existing.charityNumber ?? '') !== (data.charityNumber ?? '') ||
        (existing.companyNumber ?? '') !== (data.companyNumber ?? '')
      // Re-screened when a number changed, and screened for the first time when one has
      // just been added: the way out of `no_registration`.
      const screened =
        numbersChanged || (hasNumber && !existing.dueDiligenceCheckedAt)
          ? hasNumber
            ? await screen(values)
            : {
                dueDiligenceStatus: 'no_registration' as const,
                dueDiligenceChecks: [],
                dueDiligenceCheckedAt: new Date(),
                organisationProfile: null,
              }
          : null
      // `waiting` is the only state an edit moves on its own: the record has just been
      // given what the assessment was waiting for.
      const assess = ready && existing.custodianScoreStatus === 'waiting'
      await db
        .update(partnerships)
        .set({
          ...values,
          ...(screened ?? {}),
          ...(assess ? { custodianScoreStatus: 'queued' as const } : {}),
        })
        .where(eq(partnerships.id, existing.id))
      if (assess) await queueAssessment(existing.id)
      // An edit does NOT write an event. The timeline is what happened between the
      // foundation and the organisation, not a changelog of the form — a "details
      // edited" line for every typo would bury the introduction under noise.
      return { id: existing.id }
    }

    if (!user.clientId) throw forbidden()
    const id = crypto.randomUUID()
    const screened = hasNumber ? await screen(values) : null
    await db.batch([
      db.insert(partnerships).values({
        ...values,
        ...(screened ?? { dueDiligenceStatus: 'no_registration' as const }),
        custodianScoreStatus: ready ? 'queued' : 'waiting',
        id,
        clientId: user.clientId,
        createdByUserId: user.id,
      }),
      db.insert(partnershipEvents).values({
        partnershipId: id,
        kind: 'logged',
        // The admin's own words if they wrote any, and a plain statement of fact if not.
        // Stored verbatim rather than rendered from `kind` on read — see the table's
        // comment on why the history is a snapshot.
        body:
          data.note || `Logged as a prospective partner${data.source ? ` · ${data.source}` : ''}.`,
        actorUserId: user.id,
      }),
    ])
    if (ready) await queueAssessment(id)
    return { id }
  })

/**
 * Move a partnership along the pipeline.
 *
 * The move is named, not the destination: `canTransition` re-checks it server-side
 * against the status the row is ACTUALLY in, so a screen left open on yesterday's state
 * cannot invite an organisation somebody has since declined. A refused move is a 409,
 * not a silent no-op — the admin needs to know their screen is stale.
 *
 * Status and event go in one `db.batch` for the same reason the create does: a status
 * that moved with nothing in the history saying so is a decision with no author.
 */
export const actOnPartnership = createServerFn({ method: 'POST' })
  .validator(PartnershipActionSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)

    // `shortlist` is not in the schema's enum: it is `progressPartnership`'s move.
    const action = data.action as Exclude<PartnershipAction, 'shortlist'>
    if (!canTransition(existing.status, action)) {
      throw conflict(
        `This partnership is already “${PARTNERSHIP_STATUS_META[existing.status].label}”. Reload the page to see where it has got to.`,
      )
    }

    const meta = PARTNERSHIP_ACTION_META[action]
    const kind = (
      {
        issue_eoi: 'eoi_issued',
        invite: 'invited',
        decline: 'declined',
        reopen: 'reopened',
      } as const
    )[action]

    // The two correspondence lines are the ADMIN's statement that they sent something
    // themselves, and are worded as that. Nothing here emails anybody; when Custodian
    // does the sending, `sendPartnershipEmail` writes a differently worded line. See
    // `PARTNERSHIP_ACTION_META`. The other two are decisions taken inside the app.
    const sentence = {
      issue_eoi: 'Marked the expression of interest form as sent.',
      invite: 'Marked as invited to submit a full application.',
      decline: 'Closed.',
      reopen: 'Reopened, back to prospective.',
    }[action]

    await db.batch([
      db
        .update(partnerships)
        .set({ status: meta.to, updatedAt: new Date() })
        .where(eq(partnerships.id, existing.id)),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind,
        body: data.note ? `${sentence} ${data.note}` : sentence,
        actorUserId: user.id,
      }),
    ])
    return { id: existing.id, status: meta.to }
  })

/** A line in the relationship history that is nobody's status change — a call, a visit. */
export const addPartnershipNote = createServerFn({ method: 'POST' })
  .validator(PartnershipNoteSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const existing = await forWrite(data.id, user)
    await getDb().insert(partnershipEvents).values({
      partnershipId: existing.id,
      kind: 'note',
      body: data.body,
      actorUserId: user.id,
    })
    return { ok: true }
  })

/**
 * Retire a partnership, or bring it back — the same rule rounds and programmes follow,
 * and for a sharper reason: the introduction that produced this row was somebody's
 * favour, and deleting it deletes the answer to "did we ever follow up on James's
 * suggestion?". There is no delete.
 */
export const setPartnershipArchived = createServerFn({ method: 'POST' })
  .validator(ArchivePartnershipSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    await db.batch([
      db
        .update(partnerships)
        .set({
          archivedAt: data.archived ? new Date() : null,
          archiveNote: data.archived ? (data.note ?? null) : null,
          updatedAt: new Date(),
        })
        .where(eq(partnerships.id, existing.id)),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind: data.archived ? 'archived' : 'unarchived',
        body: data.archived
          ? data.note
            ? `Archived: ${data.note}`
            : 'Archived.'
          : 'Brought back from the archive.',
        actorUserId: user.id,
      }),
    ])
    return { ok: true }
  })

/**
 * Screen a prospect against the charity and company registers.
 *
 * The same `runDueDiligence` an application runs, against the same two registers, and
 * the result is stored in the same four columns — so the answer reads identically on
 * both screens. Running it HERE is most of the reason to log a prospect at all: it
 * costs nothing and it is the cheapest thing that can stop an afternoon being spent on
 * an organisation that was dissolved in 2019.
 *
 * `charityNumber` / `companyNumber` are optional and written FIRST when given. That is
 * the only way out of the dead end due diligence has — with both columns NULL there is
 * nothing to screen, and pressing the button again reads the same nothing however often
 * it is pressed (the same fix `rerunDueDiligence` has on the admin side).
 *
 * The grant amount the "% of income" check wants is `amount_sought` when they have said
 * and zero when they have not. Zero makes that one check unverified rather than wrong,
 * which is the right answer for a conversation that has not reached a number yet.
 */
export const screenPartnership = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      charityNumber: z.string().trim().max(40).nullable().optional(),
      companyNumber: z.string().trim().max(40).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)

    const charityNumber =
      data.charityNumber !== undefined ? data.charityNumber || null : existing.charityNumber
    const companyNumber =
      data.companyNumber !== undefined ? data.companyNumber || null : existing.companyNumber

    const screened = await screen({ ...existing, charityNumber, companyNumber })

    await db.batch([
      db
        .update(partnerships)
        .set({ charityNumber, companyNumber, ...screened, updatedAt: new Date() })
        .where(eq(partnerships.id, existing.id)),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind: 'due_diligence_run',
        body: `Due diligence run: ${screened.dueDiligenceStatus.replace(/_/g, ' ')}.`,
        actorUserId: user.id,
      }),
    ])
    return { status: screened.dueDiligenceStatus }
  })

/**
 * Run the AI assessment again, on purpose.
 *
 * The first run is automatic (see `savePartnership`); this is the button for after the
 * purpose, the value or the programme has changed. Refused while the record lacks what
 * the assessment needs, with the gap named, and while one is already on its way.
 */
export const rerunPartnershipAssessment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const existing = await forWrite(data.id, user)
    const gaps = assessmentGaps(existing)
    if (gaps.length > 0) {
      throw conflict(`The assessment needs ${gaps.join(', ')} first. Add them under Edit details.`)
    }
    if (existing.custodianScoreStatus === 'queued') {
      throw conflict('An assessment is already running. Refresh in a minute.')
    }
    await getDb()
      .update(partnerships)
      .set({ custodianScoreStatus: 'queued', updatedAt: new Date() })
      .where(eq(partnerships.id, existing.id))
    await queueAssessment(existing.id)
    return { ok: true }
  })

/**
 * Email a partner, as the foundation.
 *
 * Three kinds (`lib/sourcing/outreach.ts`): a plain message, an invitation to send an
 * expression of interest, and an invitation to apply. The invitations carry a link to
 * the FOUNDATION's own form with the invitation reference put on it here, so what comes
 * back can be tied to this partnership (`sourcing/link.ts`, `eois/receive.ts`).
 *
 * **The status moves only after Resend has accepted the message.** That is the whole
 * difference between this and "I've sent it myself" (`actOnPartnership`): the line this
 * writes is a receipt. A send that fails changes nothing and says why.
 *
 * Sent the way an award letter is: the foundation's name in From, their address in
 * Reply-To, our verified mailbox behind it. One email, one subrequest, so it runs inline
 * while the admin watches rather than on the queue.
 *
 * An invitation sent to a partner ALREADY at that stage is a chase: it sends, writes its
 * line, and moves nothing.
 */
export const sendPartnershipEmail = createServerFn({ method: 'POST' })
  .validator(SendPartnershipEmailSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    if (existing.archivedAt) throw conflict('This partner is archived. Bring them back first.')

    const action =
      data.kind === 'eoi_invite' ? 'issue_eoi' : data.kind === 'apply_invite' ? 'invite' : null
    const target = action ? PARTNERSHIP_ACTION_META[action].to : null
    const moves = action !== null && existing.status !== target
    if (action && moves && !canTransition(existing.status, action)) {
      throw conflict(
        `This partnership is already “${PARTNERSHIP_STATUS_META[existing.status].label}”. Reload the page to see where it has got to.`,
      )
    }

    let link: string | null = null
    if (data.kind !== 'message') {
      link = data.formUrl
        ? withInviteRef(data.formUrl, { kind: 'partnership', id: existing.id })
        : null
      if (!link) throw badRequest('That link is not a web address. It should start with https://')
    }

    const client = await db.query.clients.findFirst({
      where: (c, { eq }) => eq(c.id, existing.clientId),
      columns: { name: true },
      with: { profile: { columns: { awardLetterSenderName: true, awardLetterReplyTo: true } } },
    })
    const rendered = renderOutreach(data.kind, data.body, link, await letterLogo(existing.clientId))
    const sent = await sendAwardLetterEmail({
      to: data.to,
      senderName: client?.profile?.awardLetterSenderName ?? client?.name ?? null,
      replyTo: client?.profile?.awardLetterReplyTo ?? null,
      subject: data.subject,
      html: rendered.html,
      text: rendered.text,
    })
    if (!sent.ok) {
      throw conflict(`The email was not sent, and nothing has changed. ${sent.error ?? ''}`.trim())
    }

    const body =
      data.kind === 'eoi_invite'
        ? `Custodian emailed the expression of interest form to ${data.to}.`
        : data.kind === 'apply_invite'
          ? `Custodian emailed an invitation to apply to ${data.to}.`
          : `Custodian emailed ${data.to}: “${data.subject}”.`
    await db.batch([
      db
        .update(partnerships)
        .set({
          ...(moves && target ? { status: target } : {}),
          // The address it actually went to becomes the contact when there was none.
          ...(existing.contactEmail ? {} : { contactEmail: data.to }),
          updatedAt: new Date(),
        })
        .where(eq(partnerships.id, existing.id)),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind:
          data.kind === 'eoi_invite'
            ? 'eoi_issued'
            : data.kind === 'apply_invite'
              ? 'invited'
              : 'emailed',
        body,
        actorUserId: user.id,
      }),
    ])
    return { ok: true, status: moves && target ? target : existing.status }
  })

/**
 * Take a partner straight to the shortlist: no form, no email, staff vouching for the ask.
 *
 * **It creates an application, and that is the point, not a workaround.** Shortlisting,
 * the round's budget, votes and the award all live on `applications`, tied to a
 * round-programme. Making a partnership shortlistable would give one grant two statuses
 * on two screens (`partnershipStatusEnum`). So this is "skip the external form", never
 * "skip applications": the row is built from what was logged (`sourcing/application.ts`),
 * in the round the partnership was logged against, and the partnership hands over to it.
 *
 * The assessment is carried across: it is on the same six criteria by construction
 * (`partnerships/score.ts`) and was judged against this programme, since the round is the
 * partnership's own. The due diligence result is carried too. The delivery area is
 * resolved now, so the grant lands on the Insights map.
 *
 * **This writes the application at `for_review`. The caller shortlists it** with
 * `updateApplicationStatus`, the one function that owns that move, so the round-budget
 * ceiling, the first-year share and the audit row are applied by the code that already
 * applies them. If that second step is refused (budget full), the application exists
 * and says so, and can be shortlisted from its own screen.
 *
 * One `db.batch`: the application, the partnership pointing at it, and the history line
 * are one fact. A partnership that pointed at nothing after an application was made
 * would let the button be pressed twice.
 */
export const progressPartnership = createServerFn({ method: 'POST' })
  .validator(ProgressPartnershipSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    if (existing.archivedAt) throw conflict('This partner is archived. Bring them back first.')
    if (existing.applicationId || !canTransition(existing.status, 'shortlist')) {
      throw conflict(
        `This partnership is already “${PARTNERSHIP_STATUS_META[existing.status].label}”. Reload the page to see where it has got to.`,
      )
    }
    // Rows logged before the round was required. Without one there is no budget to draw
    // on and no programme to say what it was judged against.
    if (!existing.roundProgrammeId) {
      throw conflict('Choose the round and programme under Edit details first.')
    }

    const roundProgramme = await db.query.roundProgrammes.findFirst({
      where: (rp, { eq }) => eq(rp.id, existing.roundProgrammeId!),
      with: {
        round: { columns: { name: true } },
        programme: { columns: { id: true, clientId: true, name: true, tags: true } },
      },
    })
    if (!roundProgramme) throw notFoundError()
    if (roundProgramme.programme.clientId !== existing.clientId) throw forbidden()

    // Only themes the programme actually has: `applications.themes` is a subset of its
    // programme's list everywhere it is read.
    const offered = new Set(roundProgramme.programme.tags ?? [])
    const themes = (existing.tags ?? []).filter((t) => offered.has(t))
    // What the dialog sent, else what was logged: each field is optional on the wire.
    const purpose =
      (data.purpose !== undefined ? data.purpose : existing.proposedPurpose)?.trim() || null
    const deliveryArea =
      (data.deliveryArea !== undefined ? data.deliveryArea : existing.deliveryArea)?.trim() || null
    const impact =
      data.proposedImpactQuantity !== undefined
        ? data.proposedImpactQuantity
        : existing.proposedImpactQuantity
    const contactEmail = data.contactEmail !== undefined ? data.contactEmail : existing.contactEmail
    if (data.firstYearAmount != null && data.firstYearAmount > data.amount + 0.005) {
      throw badRequest('This year’s share cannot be more than the whole grant.')
    }
    const scored = existing.custodianScoreStatus === 'scored'

    const applicationId = crypto.randomUUID()
    const values = await sourcedApplicationValues(applicationId, {
      roundProgrammeId: roundProgramme.id,
      organisationName: existing.organisationName,
      contactEmail,
      charityNumber: existing.charityNumber,
      companyNumber: existing.companyNumber,
      amount: data.amount,
      firstYearAmount: data.firstYearAmount ?? null,
      purpose,
      proposedImpactQuantity: impact,
      unrestrictedReserves: data.unrestrictedReserves ?? null,
      deliveryArea,
      // There was no form, so there are no answers. What staff recorded is stated as
      // what it is, so the application does not read as an empty submission.
      responses: [
        {
          label: 'How this application came about',
          value:
            'Sourced by the foundation and taken straight to the shortlist. No application form was submitted.',
        },
        ...(existing.source ? [{ label: 'Source', value: existing.source }] : []),
        ...(purpose ? [{ label: 'Proposed purpose', value: purpose }] : []),
      ],
      themes: themes.length > 0 ? themes : null,
      themesSetBy: null,
      dueDiligence: {
        status: existing.dueDiligenceStatus,
        checks: existing.dueDiligenceChecks,
        checkedAt: existing.dueDiligenceCheckedAt,
        profile: existing.organisationProfile,
      },
      // No assessment to carry (it failed, or AI is not configured): score the
      // application in its own right rather than leave it with none.
      score: scored
        ? {
            status: 'scored',
            score: existing.custodianScore,
            detail: existing.custodianScoreDetail,
            scoredAt: existing.custodianScoredAt,
          }
        : 'queued',
    })

    await db.batch([
      db.insert(applications).values(values),
      db
        .update(partnerships)
        .set({
          applicationId,
          status: 'applied',
          // Corrections made in the dialog, so the partnership and its application agree.
          amountSought: String(data.amount),
          proposedPurpose: purpose,
          deliveryArea,
          proposedImpactQuantity: impact,
          contactEmail,
          updatedAt: new Date(),
        })
        .where(and(eq(partnerships.id, existing.id), isNull(partnerships.applicationId))),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind: 'shortlisted',
        body: `Taken straight to the shortlist for ${roundProgramme.programme.name}, ${roundProgramme.round.name}. No application form.`,
        actorUserId: user.id,
      }),
    ])
    if (!scored) {
      await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
    }
    return { applicationId }
  })

/**
 * Point a partnership at the application it turned into, by hand.
 *
 * The link is made automatically when the foundation's form hands `custodian_ref` back
 * (`sourcing/link.ts`). This is for when it did not. Both rows must be the caller's own
 * foundation's, and neither may already be linked.
 */
export const linkPartnershipApplication = createServerFn({ method: 'POST' })
  .validator(LinkPartnershipApplicationSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    if (existing.applicationId) throw conflict('This partnership already has an application.')

    const [application] = await db
      .select({ id: applications.id, organisationName: applications.organisationName })
      .from(applications)
      .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(
        and(eq(applications.id, data.applicationId), eq(programmes.clientId, existing.clientId)),
      )
      .limit(1)
    if (!application) throw notFoundError()
    const taken = await db.query.partnerships.findFirst({
      where: (p, { eq }) => eq(p.applicationId, application.id),
      columns: { id: true },
    })
    if (taken) throw conflict('That application already belongs to another partnership.')

    await db.batch([
      db
        .update(partnerships)
        .set({ applicationId: application.id, status: 'applied', updatedAt: new Date() })
        .where(and(eq(partnerships.id, existing.id), isNull(partnerships.applicationId))),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind: 'applied',
        body: 'Linked to their application.',
        actorUserId: user.id,
      }),
    ])
    return { ok: true }
  })
