import { conflict, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../db'
import { searchAny } from '../searchTerm'
import { partnerships, partnershipEvents } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { facetBy, facetByMany, type FacetOption } from '../../lib/facets'
import { clampPage, PAGE_SIZE } from '../../lib/pagination'
import { runDueDiligence } from '../dueDiligence/run'
import {
  ArchivePartnershipSchema,
  PartnershipActionSchema,
  PartnershipNoteSchema,
  SavePartnershipSchema,
} from '../../lib/validators/partnership'
import {
  canTransition,
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
// what somebody said over coffee. The record of what happened lives in
// `partnership_events`, which answers "how do we know these people" — a different
// question from the audit log's "who did this to a grant", and one that starts before
// the foundation has done anything at all.

/** The order the list arrives in when nothing has been clicked — see `APPLICATIONS_DEFAULT_SORT`. */
export const PARTNERSHIPS_DEFAULT_SORT = { by: 'logged', dir: 'desc' } as const

export const PARTNERSHIP_SORT_KEYS = [
  'organisation',
  'programme',
  'source',
  'status',
  'dueDiligence',
  'logged',
] as const
export type PartnershipSortKey = (typeof PARTNERSHIP_SORT_KEYS)[number]

const FiltersSchema = z
  .object({
    tab: z.enum(PARTNERSHIP_TAB_IDS as [PartnershipTab, ...PartnershipTab[]]).optional(),
    programmeId: z.string().optional(),
    source: z.string().optional(),
    tag: z.string().optional(),
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
    const user = await requireAuthUser()
    const filters = data ?? {}
    const empty = {
      items: [] as PartnershipRow[],
      total: 0,
      page: 1,
      pageSize: PAGE_SIZE,
      tabCounts: { to_action: 0, awaiting: 0, closed: 0 },
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
    const tab: PartnershipTab = filters.tab ?? 'to_action'
    const archived = filters.archived === true

    // The tenancy filter, and the archive line. Both are on every query below,
    // including the counts and the facets.
    const scope = and(
      eq(partnerships.clientId, user.clientId),
      archived ? sql`${partnerships.archivedAt} is not null` : isNull(partnerships.archivedAt),
    )

    // Everything except the tab, so the tab counts reflect the other filters.
    const baseWhere = and(
      scope,
      filters.programmeId ? eq(partnerships.programmeId, filters.programmeId) : undefined,
      filters.source ? eq(partnerships.source, filters.source) : undefined,
      filters.tag
        ? sql`${partnerships.tags} @> ${JSON.stringify([filters.tag])}::jsonb`
        : undefined,
      // Name, the foundation's own reference, or where they are — the three things
      // somebody types when they half-remember an organisation.
      searchAny(
        filters.q,
        partnerships.organisationName,
        partnerships.reference,
        partnerships.location,
      ),
    )

    // The archive is not a pipeline, so it has no tabs and takes no tab filter. Without
    // this the default tab ("To action") is applied to a set of rows that by definition
    // have nobody waiting on them, and the archive renders empty under a header
    // stating how many things are in it.
    const where = archived
      ? baseWhere
      : and(baseWhere, inArray(partnerships.status, statusesForTab(tab)))

    const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC'
    const sortExpr = (() => {
      switch (filters.sortBy) {
        case 'organisation':
          return sql`lower(${partnerships.organisationName}) ${sql.raw(dir)}`
        case 'source':
          return sql`lower(${partnerships.source}) ${sql.raw(dir)} NULLS LAST`
        case 'logged':
          return sql`${partnerships.createdAt} ${sql.raw(dir)}`
        // Pipeline order, not alphabetical: a status column sorted A–Z puts "Declined"
        // above "EOI received", which is the opposite of useful.
        case 'status':
          return sql`CASE ${partnerships.status} WHEN 'eoi_received' THEN 0 WHEN 'prospective' THEN 1 WHEN 'eoi_issued' THEN 2 WHEN 'invited' THEN 3 ELSE 4 END ${sql.raw(dir)}`
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

    const [rows, totals, statusRows, facetRows, archivedRows] = await Promise.all([
      listRows(where, orderBy, (page - 1) * PAGE_SIZE),
      db.select({ total: count() }).from(partnerships).where(where),
      db
        .select({ status: partnerships.status, count: count() })
        .from(partnerships)
        .where(baseWhere)
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

    const counted = Object.fromEntries(statusRows.map((r) => [r.status, r.count])) as Record<
      PartnershipStatus,
      number | undefined
    >
    const countFor = (t: PartnershipTab) =>
      statusesForTab(t).reduce((sum, s) => sum + (counted[s] ?? 0), 0)

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
    const user = await requireAuthUser()
    const row = await getDb().query.partnerships.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: {
        programme: { columns: { id: true, name: true, colour: true } },
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
    return row
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
 * Create or update a partnership — the whole dialog in one call, as `saveProgramme` is.
 *
 * On create, two rows are written: the partnership and the first line of its history.
 * They go in ONE `db.batch` because they are one fact — a prospect logged with no
 * "logged" event has a timeline that begins in the middle, and the screen would have
 * nothing to say about where the relationship came from, which is the whole reason
 * somebody typed it in. (`db.transaction()` is not available on the neon-http driver;
 * see CLAUDE.md.)
 */
export const savePartnership = createServerFn({ method: 'POST' })
  .validator(SavePartnershipSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()

    const values = {
      organisationName: data.organisationName,
      reference: data.reference,
      organisationType: data.organisationType,
      location: data.location,
      charityNumber: data.charityNumber,
      companyNumber: data.companyNumber,
      source: data.source,
      programmeId: data.programmeId,
      tags: data.tags,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      amountSought: data.amountSought === null ? null : String(data.amountSought),
      updatedAt: new Date(),
    }

    if (data.id) {
      const existing = await forWrite(data.id, user)
      await db.update(partnerships).set(values).where(eq(partnerships.id, existing.id))
      // An edit does NOT write an event. The timeline is what happened between the
      // foundation and the organisation, not a changelog of the form — a "details
      // edited" line for every typo would bury the introduction under noise.
      return { id: existing.id }
    }

    if (!user.clientId) throw forbidden()
    const id = crypto.randomUUID()
    await db.batch([
      db.insert(partnerships).values({
        ...values,
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
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)

    const action = data.action as PartnershipAction
    if (!canTransition(existing.status, action)) {
      throw conflict(
        `This partnership is already “${PARTNERSHIP_STATUS_META[existing.status].label}” — reload the page to see where it has got to.`,
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

    // Written the way the button is worded, and for the same reason: the two
    // correspondence lines are the ADMIN's statement that they sent something, not
    // Custodian's record of having sent it. Nothing here emails anybody — see
    // `PARTNERSHIP_ACTION_META`. The other two are decisions taken inside the app and
    // say so plainly.
    const sentence = {
      issue_eoi: 'Marked the expression-of-interest form as sent.',
      invite: 'Marked as invited to submit a full application.',
      decline: 'Closed — not pursuing.',
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
            ? `Archived — ${data.note}`
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
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)

    const charityNumber =
      data.charityNumber !== undefined ? data.charityNumber || null : existing.charityNumber
    const companyNumber =
      data.companyNumber !== undefined ? data.companyNumber || null : existing.companyNumber

    const result = await runDueDiligence({
      charityNumber,
      companyNumber,
      organisationName: existing.organisationName,
      amountRequested: Number(existing.amountSought ?? 0),
    })

    await db.batch([
      db
        .update(partnerships)
        .set({
          charityNumber,
          companyNumber,
          dueDiligenceStatus: result.status,
          dueDiligenceChecks: result.checks,
          dueDiligenceCheckedAt: new Date(result.checkedAt),
          organisationProfile: result.profile,
          updatedAt: new Date(),
        })
        .where(eq(partnerships.id, existing.id)),
      db.insert(partnershipEvents).values({
        partnershipId: existing.id,
        kind: 'due_diligence_run',
        body: `Due diligence run — ${result.status.replace(/_/g, ' ')}.`,
        actorUserId: user.id,
      }),
    ])
    return { status: result.status }
  })
