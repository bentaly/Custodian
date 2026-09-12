import { conflict, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  and,
  eq,
  count,
  inArray,
  sql,
  ne,
  gte,
  lte,
  isNotNull,
  desc,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import { getDb } from '../db'
import {
  applications,
  roundProgrammes,
  programmes,
  applicationVotes,
  users,
  awards,
  awardInstalments,
  reportSchedule,
  reports,
  clientProfiles,
} from '../../../drizzle/schema'
import { searchAny } from '../searchTerm'
import { roundProgrammeSpend, roundProgrammeYear, spentThisYear } from '../applications/roundSpend'
import { DEFAULT_FY_END_MONTH } from '../../lib/financialYear'
import { roundFinancialYear } from '../../lib/roundYear'
import { resolveFirstYearAmount, suggestFirstYearAmount } from '../../lib/multiYear'
import { requireAuthUser, requireRole } from '../session'
import { canSeePayments } from '../../lib/roles'
import { recordAudit } from '../audit'
import {
  assertApplicationAccess,
  assertClientAccess,
  intersectScope,
  visibleRoundProgrammeIds,
} from '../scope'
import {
  ApplicationFiltersSchema,
  UpdateApplicationStatusSchema,
} from '../../lib/validators/application'
import { runDueDiligence } from '../dueDiligence/run'
import { dueStatus, type ScheduleStatus } from '../../lib/schedule'
import { reportLabel } from '../../lib/reportLabel'
import { reportingTimeline } from '../../lib/reportTimeline'
import { impactUnitLabel } from '../../lib/impactUnits'
import { facetBy, facetByMany, type FacetOption } from '../../lib/facets'
import { paginate, PAGE_SIZE } from '../../lib/pagination'
import { scoreBandFor } from '../../lib/scoreBands'
import { sortRows } from '../../lib/sortRows'
import {
  filterWhere as awardFilterWhere,
  grantsQuery as awardGrantsQuery,
  type GrantRow as AwardGrantRow,
  type GrantsQuery as AwardGrantsQuery,
} from '../awards/query'
import { recomputeAwardStatus } from '../awards/status'
import { deliveryAreaLabel, NO_REGION } from '../../lib/deprivation/types'

/**
 * The order the list arrives in when nothing has been clicked — and therefore the sort
 * arrow the header DRAWS on landing. One constant, read by the SQL above and by the
 * screen's `DataTable`, so the mark and the order cannot disagree. Before this, every
 * list opened looking unsorted while being sorted.
 */
export const APPLICATIONS_DEFAULT_SORT = { by: 'received', dir: 'desc' } as const

export const listApplications = createServerFn({ method: 'GET' })
  .validator(ApplicationFiltersSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const { page, pageSize, ...filters } = data

    let filterIds: string[] | undefined
    if (filters.roundId || filters.programmeId || filters.tag) {
      // Tag lives on the programme (jsonb array), so resolve it by joining programmes.
      const conds = and(
        filters.roundId ? eq(roundProgrammes.roundId, filters.roundId) : undefined,
        filters.programmeId ? eq(roundProgrammes.programmeId, filters.programmeId) : undefined,
        filters.tag
          ? sql`${programmes.tags} @> ${JSON.stringify([filters.tag])}::jsonb`
          : undefined,
      )
      const rows = filters.tag
        ? await getDb()
            .select({ id: roundProgrammes.id })
            .from(roundProgrammes)
            .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
            .where(conds)
        : await getDb().select({ id: roundProgrammes.id }).from(roundProgrammes).where(conds)
      filterIds = rows.map((r) => r.id)
    }

    // Tenant scope: restrict to the caller's client (null = superadmin, unrestricted),
    // then intersect with any round/programme/tag filter. An empty set means nothing
    // matches — including a crafted roundId belonging to another client.
    const roundProgrammeIds = intersectScope(await visibleRoundProgrammeIds(user), filterIds)
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) {
      return { items: [], total: 0, page, pageSize, statusCounts: {}, allCount: 0 }
    }

    // The band's bounds come from `lib/scoreBands`, so the rows this returns are exactly
    // the rows wearing that colour. `min`/`max` are inclusive; the `isNotNull` matters
    // only for the bottom band, where an unscored row would otherwise fall through.
    const band = scoreBandFor(filters.scoreBand)
    const scoreBandFilter = band
      ? and(
          isNotNull(applications.custodianScore),
          gte(applications.custodianScore, band.min),
          lte(applications.custodianScore, band.max),
        )
      : undefined

    // Everything except the status filter — used both for the status-tab counts
    // (so each tab reflects the other active filters) and as the base of `where`.
    // The date window is inclusive of both calendar days, so `to` runs to the end
    // of that day rather than to midnight at its start.
    const baseWhere = and(
      roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
      // Organisation OR the foundation's own reference — which is what the box has
      // always said ("Search organisation or ID…") and, until `searchAny`, not what it
      // did: only the name was matched, so no reference a reviewer typed ever found its
      // row.
      searchAny(filters.q, applications.organisationName, applications.externalApplicationId),
      filters.submittedFrom
        ? gte(applications.submittedAt, new Date(`${filters.submittedFrom}T00:00:00.000Z`))
        : undefined,
      filters.submittedTo
        ? lte(applications.submittedAt, new Date(`${filters.submittedTo}T23:59:59.999Z`))
        : undefined,
      scoreBandFilter,
    )

    const where = and(
      baseWhere,
      filters.status ? eq(applications.status, filters.status) : undefined,
    )

    // Column sort. Categorical columns (status / due diligence) get an explicit
    // ordering; the rest sort naturally. Newest-first is the default and the tiebreak.
    const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC'
    const sortExpr = (() => {
      switch (filters.sortBy) {
        case 'organisation':
          return sql`lower(${applications.organisationName}) ${sql.raw(dir)}`
        case 'amount':
          return sql`${applications.amountRequested} ${sql.raw(dir)} NULLS LAST`
        case 'received':
          return sql`${applications.submittedAt} ${sql.raw(dir)}`
        case 'score':
          return sql`${applications.custodianScore} ${sql.raw(dir)} NULLS LAST`
        case 'status':
          return sql`CASE ${applications.status} WHEN 'for_review' THEN 0 WHEN 'shortlisted' THEN 1 WHEN 'awarded' THEN 2 WHEN 'declined' THEN 3 ELSE 4 END ${sql.raw(dir)}`
        case 'dueDiligence':
          return sql`CASE ${applications.dueDiligenceStatus} WHEN 'blocked' THEN 0 WHEN 'warning' THEN 1 WHEN 'review' THEN 2 WHEN 'clear' THEN 3 ELSE 4 END ${sql.raw(dir)}`
        default:
          return null
      }
    })()
    // Received IS the default order and the tiebreak, so sorting by it needs neither
    // appended — a second key on the same column would only repeat itself.
    const orderBy = !sortExpr
      ? [desc(applications.submittedAt)]
      : filters.sortBy === APPLICATIONS_DEFAULT_SORT.by
        ? [sortExpr]
        : [sortExpr, desc(applications.submittedAt)]

    const [items, totals, statusRows] = await Promise.all([
      getDb().query.applications.findMany({
        where,
        with: { roundProgramme: { with: { programme: { with: { client: true } } } } },
        orderBy,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      getDb().select({ total: count() }).from(applications).where(where),
      getDb()
        .select({ status: applications.status, count: count() })
        .from(applications)
        .where(baseWhere)
        .groupBy(applications.status),
    ])

    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.count]))
    const allCount = statusRows.reduce((s, r) => s + r.count, 0)

    return { items, total: totals[0]?.total ?? 0, page, pageSize, statusCounts, allCount }
  })

export const getApplication = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: {
        roundProgramme: { with: { programme: { with: { client: true } }, round: true } },
        // Only for the detail header's link through to the grant. An awarded
        // application's status is immutable here (see `updateApplicationStatus`), so
        // the award screen is the only place its decision can still be acted on.
        award: { columns: { id: true } },
      },
    })
    if (!application) throw notFoundError()
    assertClientAccess(user, application.roundProgramme.programme.clientId)

    // Whether this foundation treats the round-programme budget as a ceiling, and the
    // financial year that budget is drawn from — the screen needs the flag to know
    // whether Shortlist is available, and the year to work out what is left.
    const profile = await getDb().query.clientProfiles.findFirst({
      where: (p, { eq }) => eq(p.clientId, application.roundProgramme.programme.clientId),
      columns: { enforceRoundBudget: true, financialYearEndMonth: true },
    })
    // The round's OWN year, not whichever is current — a round that closed last March is
    // still spending last March's allocation.
    const endMonth = profile?.financialYearEndMonth ?? DEFAULT_FY_END_MONTH
    const fy = roundFinancialYear(application.roundProgramme.round, endMonth)

    // What the round has already spent of this year's budget, on the SAME basis as the
    // shortlist meter and the ceiling in `updateApplicationStatus` — this screen's
    // "Budget full" button is a courtesy, and a courtesy that disagrees with the gate it
    // is predicting is worse than no button at all.
    //
    // This application is excluded so the figure means "already spent, apart from this
    // one" whether or not it is itself shortlisted. The screen adds its own drawdown.
    const spend = await roundProgrammeSpend(getDb(), [application.roundProgrammeId], {
      excludeApplicationId: application.id,
      financialYearEndMonth: endMonth,
    })
    const committedThisYear = spentThisYear(spend.get(application.roundProgrammeId))

    return {
      ...application,
      // The applicant supplies these at submission, so they ride along on the row —
      // but they are the same account number and sort code Finance is gated on, and
      // `ApplicationFields` renders them on this screen. Withheld from roles that
      // cannot see the payment schedule; the section disappears rather than showing
      // blanks, because `bankRows` filters out empty values.
      ...(canSeePayments(user.role)
        ? {}
        : {
            bankName: null,
            bankAccountName: null,
            bankAccountNumber: null,
            bankSortCode: null,
          }),
      // This year's cash already drawn from the round-programme's budget, excluding this
      // application. Named for the basis rather than inheriting the old name, so nothing
      // can read it as a commitment total by accident.
      roundProgrammeCommittedThisYear: committedThisYear,
      /** The financial year that budget belongs to, for the screen's wording. */
      roundFinancialYear: fy,
      /** What this ask draws from the round this year: stated if anyone said, else suggested. */
      firstYearAmount: resolveFirstYearAmount({
        amountRequested: parseFloat(application.amountRequested),
        firstYearAmount:
          application.firstYearAmount === null ? null : parseFloat(application.firstYearAmount),
        grantDurationYears: application.roundProgramme.grantDurationYears,
      }),
      /** The suggestion, always — so the dialog can offer "reset to suggested". */
      firstYearSuggested: suggestFirstYearAmount(
        parseFloat(application.amountRequested),
        application.roundProgramme.grantDurationYears,
      ),
      /** True while nobody has overridden the suggestion. */
      firstYearIsSuggested: application.firstYearAmount === null,
      // A foundation with no profile row has never opened the setting, so it gets the
      // default: the budget is a target, not a gate.
      enforceRoundBudget: profile?.enforceRoundBudget ?? false,
    }
  })

/**
 * Re-run the register checks, optionally supplying the numbers to check against.
 *
 * Without the numbers this is a plain retry, for a check that failed on a network
 * blip. With them it is the only way to screen an application that never captured a
 * registration number — and re-running alone cannot help there, because it reads the
 * same NULL columns and returns `review` with no checks, however many times it is
 * pressed. That dead end is reachable two ways: a grant imported from a foundation's
 * back catalogue (born awarded, deliberately unscreened, and the workbook treats a
 * missing number as a degradation rather than a blocker, because refusing history is
 * not an option), and any application awarded before the one-of gate existed.
 *
 * Deliberately allowed after an award, unlike rewriting an ingest's mapping: a
 * registration number is not a figure the award letter was written from, and a grantee
 * you are still paying instalments to is exactly the one worth screening late.
 */
export const rerunDueDiligence = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      // Absent = re-check whatever is already on the application.
      charityNumber: z.string().max(50).trim().optional(),
      companyNumber: z.string().max(50).trim().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)

    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
    })
    if (!application) throw notFoundError()

    const supplied = data.charityNumber !== undefined || data.companyNumber !== undefined
    const charityNumber = supplied
      ? (data.charityNumber?.trim() ?? '') || null
      : application.charityNumber
    const companyNumber = supplied
      ? (data.companyNumber?.trim() ?? '') || null
      : application.companyNumber

    // Clearing both would deliberately make the application unscreenable — the exact
    // state the one-of tier exists to prevent. Refuse rather than quietly comply.
    if (supplied && !charityNumber && !companyNumber) {
      throw new Error(
        'Give a charity number or a company number — with neither there is no register to check against.',
      )
    }

    const result = await runDueDiligence({
      charityNumber,
      companyNumber,
      organisationName: application.organisationName,
      amountRequested: Number(application.amountRequested),
    })

    const [updated] = await getDb()
      .update(applications)
      .set({
        ...(supplied ? { charityNumber, companyNumber } : {}),
        dueDiligenceStatus: result.status,
        dueDiligenceChecks: result.checks,
        dueDiligenceCheckedAt: new Date(result.checkedAt),
        organisationProfile: result.profile,
      })
      .where(eq(applications.id, data.id))
      .returning()

    // Supplying a registration number against an existing grant is a judgement a person
    // made about who they are funding, so it belongs in the feed, not just in a column.
    if (supplied) {
      await recordAudit({
        actorUserId: user.id,
        action: 'application_registration_set',
        applicationId: data.id,
        metadata: { charityNumber, companyNumber, dueDiligenceStatus: result.status },
      })
    }
    return updated!
  })

export const getRoundBudgetSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ roundId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    const rps = await getDb().query.roundProgrammes.findMany({
      where: (rp, { eq }) => eq(rp.roundId, data.roundId),
      with: { programme: true },
      orderBy: (rp, { asc }) => [asc(rp.createdAt)],
    })
    if (rps.length === 0) return []
    // All round-programmes in a round share a client; gate on the first.
    assertClientAccess(user, rps[0]!.programme.clientId)

    const rpIds = rps.map((rp) => rp.id)

    // Committed money split into its two tiers: awarded (a real grant) vs shortlisted
    // (still awaiting decision). The round-budget dominos bar renders them as separate
    // opacity bands, so they can't stay lumped into a single "committed" figure.
    const [committedRows, countRows] = await Promise.all([
      getDb()
        .select({
          roundProgrammeId: applications.roundProgrammeId,
          awarded: sql<string>`COALESCE(SUM(CASE WHEN ${applications.status} = 'awarded' THEN COALESCE(${awards.amountAwarded}, ${applications.amountRequested}) ELSE 0 END), 0)`,
          shortlisted: sql<string>`COALESCE(SUM(CASE WHEN ${applications.status} = 'shortlisted' THEN ${applications.amountRequested} ELSE 0 END), 0)`,
          awardedCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${applications.status} = 'awarded') AS integer)`,
          shortlistedCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${applications.status} = 'shortlisted') AS integer)`,
        })
        .from(applications)
        .leftJoin(awards, eq(awards.applicationId, applications.id))
        .where(
          and(
            inArray(applications.roundProgrammeId, rpIds),
            inArray(applications.status, ['shortlisted', 'awarded']),
          ),
        )
        .groupBy(applications.roundProgrammeId),
      // Total applications per programme (all statuses) — drives the programme tab counts.
      getDb()
        .select({ roundProgrammeId: applications.roundProgrammeId, total: count() })
        .from(applications)
        .where(inArray(applications.roundProgrammeId, rpIds))
        .groupBy(applications.roundProgrammeId),
    ])

    const byRpId = new Map(committedRows.map((r) => [r.roundProgrammeId, r]))
    const countByRpId = new Map(countRows.map((r) => [r.roundProgrammeId, r.total]))

    return rps.map((rp) => {
      const row = byRpId.get(rp.id)
      const awarded = row ? parseFloat(row.awarded) : 0
      const shortlisted = row ? parseFloat(row.shortlisted) : 0
      return {
        roundProgrammeId: rp.id,
        programmeId: rp.programmeId,
        programmeName: rp.programme.name,
        tags: (rp.programme.tags as string[] | null) ?? [],
        budget: rp.budget ? parseFloat(rp.budget) : null,
        awarded,
        shortlisted,
        committed: awarded + shortlisted,
        awardedCount: row?.awardedCount ?? 0,
        shortlistedCount: row?.shortlistedCount ?? 0,
        total: countByRpId.get(rp.id) ?? 0,
      }
    })
  })

export const updateApplicationStatus = createServerFn({ method: 'POST' })
  .validator(UpdateApplicationStatusSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const { id, status } = data
    await assertApplicationAccess(user, id)

    // An awarded application has a live award row hanging off it — its status can
    // only change by cancelling the award, never by sidestepping it here.
    const current = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, id),
      columns: { status: true },
    })
    if (!current) throw notFoundError()
    if (current.status === 'awarded') {
      throw conflict('An awarded application cannot change status; cancel the award instead')
    }

    // What this ask draws from the round's budget THIS YEAR. The budget counts this
    // year's cash, not the whole commitment (`src/lib/multiYear.ts`), so a multi-year
    // grant draws its first year's share — stated by whoever is shortlisting it, or the
    // suggestion when they accepted it. Resolved here rather than in the gate below
    // because it is also what gets STORED, and the two must be the same number.
    let firstYear: number | null = null
    if (status === 'shortlisted') {
      const app = await getDb().query.applications.findFirst({
        where: (a, { eq }) => eq(a.id, id),
        with: { roundProgramme: { with: { programme: { columns: { clientId: true } } } } },
      })
      if (!app) throw notFoundError()

      // `undefined` is "accept the suggestion" and stores NULL; an explicit number is an
      // override. Either way the figure the gate checks is the one the meter will show,
      // because both run it through `resolveFirstYearAmount`.
      firstYear = data.firstYearAmount ?? null
      const drawdown = resolveFirstYearAmount({
        amountRequested: parseFloat(app.amountRequested),
        firstYearAmount: firstYear,
        grantDurationYears: app.roundProgramme.grantDurationYears,
      })

      // The budget ceiling is OPT-IN (`client_profiles.enforce_round_budget`, default
      // off). Most foundations shortlist more than they can fund on purpose and choose
      // between the applications afterwards; the ones that treat the round-programme
      // budget as a hard limit turn it on in Settings. This is the boundary — the
      // application screen's "Budget full" button reads the same flag, but a disabled
      // button is a courtesy, not a gate.
      const budget = app.roundProgramme.budget ? parseFloat(app.roundProgramme.budget) : null
      // The flag is read BEFORE the rollup, not beside it: with the ceiling off — the
      // default — there is nothing to compare the sum against, and the query costs a
      // subrequest on every shortlisting for an answer nobody looks at.
      const profile =
        budget === null
          ? null
          : await getDb().query.clientProfiles.findFirst({
              where: (p, { eq }) => eq(p.clientId, app.roundProgramme.programme.clientId),
              columns: { enforceRoundBudget: true, financialYearEndMonth: true },
            })
      if (budget !== null && profile?.enforceRoundBudget) {
        // The SAME function the shortlist meter reads. It used to be a sum written here
        // over `COALESCE(amount_awarded, amount_requested)`, which was safe while both
        // screens counted the whole ask and is not safe now they count a year of it: the
        // meter would have said there was room and this would have refused, both
        // behaving as designed. See `roundProgrammeSpend`.
        const endMonth = profile.financialYearEndMonth ?? DEFAULT_FY_END_MONTH
        const fy = await roundProgrammeYear(getDb(), app.roundProgrammeId, endMonth)
        const spend = await roundProgrammeSpend(getDb(), [app.roundProgrammeId], {
          excludeApplicationId: id,
          financialYearEndMonth: endMonth,
        })
        const committed = spentThisYear(spend.get(app.roundProgrammeId))

        if (committed + drawdown > budget) {
          const fmt = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
          const remaining = budget - committed
          throw conflict(
            `Budget limit reached — ${fmt(remaining > 0 ? remaining : 0)} remaining in ${fy.label}, this application draws ${fmt(drawdown)}`,
          )
        }
      }
    }

    const [application] = await getDb()
      .update(applications)
      .set({
        status,
        // Declining stamps the decision; moving back out of declined clears it, so
        // the activity feed doesn't keep reporting a decision that was undone.
        decisionAt: status === 'declined' ? new Date() : null,
        // Written only on the shortlist path, and cleared on the way back out: a figure
        // left behind by a shortlisting that was undone would silently become the
        // drawdown if the application were shortlisted again later, under a round budget
        // nobody had re-checked it against.
        firstYearAmount:
          status === 'shortlisted' ? (firstYear === null ? null : String(firstYear)) : null,
      })
      .where(eq(applications.id, id))
      .returning()

    // Log the interesting human decisions. Awards are logged in `createAwards`
    // (the path that actually mints the grant), so they're excluded here.
    const auditAction =
      status === 'shortlisted'
        ? 'application_shortlisted'
        : status === 'declined'
          ? 'application_declined'
          : null
    if (auditAction) {
      await recordAudit({ actorUserId: user.id, action: auditAction, applicationId: id })
    }
    return application!
  })

/**
 * Correct how much of a shortlisted ask falls in this financial year.
 *
 * The same figure `updateApplicationStatus` captures when shortlisting, editable
 * afterwards — because the schedule is often discussed after the board has agreed in
 * principle, and re-shortlisting an application just to fix a number would write an audit
 * row saying a decision was made again.
 *
 * Deliberately NOT gated on the round budget. This is a correction to what a grant was
 * always going to cost this year, not a new call on the budget, and refusing it would
 * leave the meter knowingly wrong with no way to fix it. Going over shows as an overspend
 * on the shortlist card, which is what that card is for.
 *
 * **Refused once an award exists**, like rewriting an ingest's mapping: from then on the
 * award's real instalments are this year's share (`roundProgrammeSpend`) and this column
 * is no longer read, so accepting a write would store a figure that changes nothing and
 * silently disagrees with the schedule.
 */
export const setFirstYearAmount = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      /** `null` resets to the suggestion. */
      amount: z.number().min(0).max(1_000_000_000).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)

    const app = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      columns: { status: true, amountRequested: true },
      with: { roundProgramme: { columns: { grantDurationYears: true } } },
    })
    if (!app) throw notFoundError()
    if (app.status === 'awarded') {
      throw conflict(
        'This grant has been awarded — its payment schedule now says what falls in each year.',
      )
    }
    if (app.status !== 'shortlisted') {
      throw conflict('Only a shortlisted application draws on a round budget.')
    }
    const requested = parseFloat(app.amountRequested)
    if (data.amount !== null && data.amount > requested) {
      throw conflict('That is more than the application is asking for.')
    }

    const [updated] = await getDb()
      .update(applications)
      .set({ firstYearAmount: data.amount === null ? null : String(data.amount) })
      .where(eq(applications.id, data.id))
      .returning({ id: applications.id, firstYearAmount: applications.firstYearAmount })

    return {
      id: updated!.id,
      firstYearAmount: resolveFirstYearAmount({
        amountRequested: requested,
        firstYearAmount: data.amount,
        grantDurationYears: app.roundProgramme.grantDurationYears,
      }),
      firstYearIsSuggested: data.amount === null,
    }
  })

// Awards screen: the register of every grant ever awarded for the caller's client —
// across all rounds and programmes, regardless of payment progress. Reads `awards`
// (via the awarded application that produced each), with instalments rolled up for
// paid-to-date. Filters mirror the Applications list (round / programme / tag / search).
export const listAwards = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      roundId: z.uuid().optional(),
      programmeId: z.uuid().optional(),
      tag: z.string().min(1).max(100).optional(),
      q: z.string().trim().min(1).max(255).optional(),
      /** Award lifecycle, not application status — every row here is already awarded. */
      status: z.enum(['active', 'completed', 'cancelled']).optional(),
      /**
       * Delivery region, or `NO_REGION` for the grants whose location never resolved.
       * Free-form rather than an enum: the values are ONS region names carried on the
       * application, so an enum here would be a second list to keep in step with the
       * geography data — and an unknown value simply matches nothing.
       */
      region: z.string().min(1).max(100).optional(),
      /** Inclusive award-date window (`yyyy-mm-dd`), against the decision date. */
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      /** Column sort. Applied in memory over the whole filtered set — see `sortRows`. */
      sortBy: z
        .enum([
          'organisation',
          'programme',
          'round',
          'awarded',
          'amount',
          'paid',
          'duration',
          'geography',
          'status',
        ])
        .optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      page: z.number().int().positive().optional(),
      /** Raised only by the CSV export, which is the whole filtered set by definition. */
      pageSize: z.number().int().positive().max(10_000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    // Only the *context* filter — the round — narrows the set the facets are counted
    // over. Everything else (programme, theme, status, dates, search) is applied inside
    // `awardsList`, so the filter options describe the round you are in rather than
    // shrinking as you use them.
    let contextIds: string[] | undefined
    if (data.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, data.roundId))
      contextIds = rows.map((r) => r.id)
    }

    const visible = await visibleRoundProgrammeIds(user)
    const roundProgrammeIds = intersectScope(visible, contextIds)
    // An empty scope is a caller who can see nothing; `inArray(x, [])` is a SQL error,
    // so it never reaches the query.
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) return emptyAwardsList()
    // The tenant's whole register, round pill and all filters aside — what the KPI line
    // and the portfolio bar above the filter row are counted over. See `awardsList`.
    return awardsList(getDb(), roundProgrammeIds, visible ?? undefined, data)
  })

/**
 * Everything the register is filtered, sorted and paged by — the validator's shape.
 *
 * `roundId` is here because the validator has it, but `awardsList` does NOT read it:
 * the round is the context, already folded into `scope` by the caller so the facets
 * are counted over it. Passing a round here alone would silently filter nothing.
 */
export type AwardsListInput = {
  roundId?: string
  programmeId?: string
  tag?: string
  q?: string
  status?: 'active' | 'completed' | 'cancelled'
  region?: string
  from?: string
  to?: string
  sortBy?: AwardSortKey
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

type AwardSortKey =
  | 'organisation'
  | 'programme'
  | 'round'
  | 'awarded'
  | 'amount'
  | 'paid'
  | 'duration'
  | 'geography'
  | 'status'

/** A grant that still represents a promise — the money rule's scope for committed. */
function notCancelled(g: AwardGrantsQuery): SQL {
  return sql`${g.status} <> 'cancelled'`
}

/**
 * The Awards register, as a plain function of (connection, tenant scope, filters) —
 * the same seam Finance has, so everything below the auth check can be run without a
 * session, by a script against staging or by a test.
 *
 * Rows, the count, the KPI totals, the portfolio split and all five facets go out as
 * ONE `db.batch()`: one round trip, one snapshot, so a KPI cannot disagree with the
 * table beneath it.
 */
export async function awardsList(
  db: ReturnType<typeof getDb>,
  scope: string[] | undefined,
  portfolioScope: string[] | undefined,
  data: AwardsListInput,
) {
  const g = awardGrantsQuery(db, scope)
  // The same register with NOTHING applied to it — not the filters, not the round.
  //
  // The KPI line under the <h1> and the "Portfolio by programme" bar both sit above the
  // filter row, and a control narrows only what is below it. Counted through `where`,
  // as they were, a foundation filtering to one programme watched "£469k awarded"
  // become "£71k" and the bar collapse to a single band still captioned "by programme"
  // — the portfolio redrawn as the thing that was meant to be measured against it.
  //
  // The ROUND pill is included in that: on this screen the round is one narrowing among
  // several (see `AwardsSearch`), and it lives in the filter row with the others, so it
  // must not move these either. That is why this is a second query rather than reusing
  // `g`, whose scope the round is folded into.
  const portfolio = awardGrantsQuery(db, portfolioScope)
  const pageSize = data.pageSize ?? PAGE_SIZE
  const page = data.page && data.page > 0 ? data.page : 1
  const where = awardFilterWhere(g, data)

  const facetOn = (value: SQLWrapper, label: SQLWrapper) =>
    db
      .select({
        value: value as SQL<string | null>,
        label: label as SQL<string | null>,
        count: sql<number>`(count(*))::int`,
      })
      .from(g)
      .groupBy(value as SQL, label as SQL)

  const [
    rows,
    countRow,
    totalsRow,
    byProgramme,
    programmeFacet,
    themeFacet,
    statusFacet,
    roundFacet,
    regionFacet,
  ] = await db.batch([
    db
      .select()
      .from(g)
      .where(where)
      .orderBy(...awardOrderFor(g, data.sortBy, data.sortDir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`(count(*))::int` })
      .from(g)
      .where(where),
    // The money rule, on the register's own headline (see CLAUDE.md). It was missing
    // here: every figure summed the whole book, so a cancelled grant was still counted
    // as money committed and its unpaid half as money owed. Finance sits one screen away
    // and has always applied the rule, so the two disagreed by the value of every
    // cancelled grant — exactly the failure the 2026-08-27 audit was written after, on
    // the one register that audit did not reach.
    //
    //   awarded / outstanding — EXCLUDE cancelled. There is no promise left to keep and
    //                           nothing left to pay.
    //   paid                  — INCLUDES cancelled. The money left the building, and
    //                           paid history has to reconcile against the foundation's
    //                           own ledger.
    //   count                 — ALL of them. It counts DECISIONS, not money, and the
    //                           cancelled grant is listed in the rows below it wearing a
    //                           "Cancelled" pill. A header saying 11 over a list of 12
    //                           would read as a bug in the list.
    db
      .select({
        totalAwarded: sql<number>`coalesce(sum(${portfolio.amountAwarded}) filter (where ${notCancelled(portfolio)}), 0)::float8`,
        count: sql<number>`(count(*))::int`,
        multiYearCount: sql<number>`(count(*) filter (where ${portfolio.durationYears} > 1))::int`,
        paidToDate: sql<number>`coalesce(sum(${portfolio.paidToDate}), 0)::float8`,
        outstanding: sql<number>`coalesce(sum(${portfolio.outstanding}) filter (where ${notCancelled(portfolio)}), 0)::float8`,
      })
      .from(portfolio),
    // The portfolio split, grouped by programme NAME: a grant whose programme was
    // deleted still spent money, and it is read under one heading rather than
    // disappearing from the bar. Each keeps its own colour, so the bar speaks the
    // same vocabulary as the programme cards.
    db
      .select({
        name: sql<string>`coalesce(${portfolio.programmeName}, 'Unattributed')`,
        colour: sql<string | null>`max(${portfolio.programmeColour})`,
        // Committed money, so cancelled is out — the bar has to add up to the "awarded"
        // figure printed directly above it.
        amount: sql<number>`coalesce(sum(${portfolio.amountAwarded}) filter (where ${notCancelled(portfolio)}), 0)::float8`,
      })
      .from(portfolio)
      .where(notCancelled(portfolio))
      .groupBy(sql`1`)
      .orderBy(sql`3 desc`),
    // Facets describe the round you are in — the scope above — before the transient
    // filters, so using one pill never prunes the options of the pill beside it.
    facetOn(g.programmeId, g.programmeName),
    db
      .select({
        value: sql<string>`theme.value`,
        label: sql<string>`theme.value`,
        count: sql<number>`(count(*))::int`,
      })
      .from(g)
      .innerJoin(sql`lateral jsonb_array_elements_text(${g.tags}) as theme(value)`, sql`true`)
      .groupBy(sql`theme.value`),
    facetOn(g.status, g.status),
    facetOn(g.roundId, g.roundName),
    // Counted with a NULL group, unlike the four above: `namedFacet` drops NULLs
    // because "no programme" is a gap, whereas "no location recorded" is the pill a
    // grants officer is looking for. It becomes the `NO_REGION` option below.
    facetOn(g.deliveryRegion, g.deliveryRegion),
  ])

  return {
    items: rows.map(toAwardRow),
    total: countRow[0]?.n ?? 0,
    page,
    pageSize,
    totals: { ...totalsRow[0]!, byProgramme },
    facets: {
      programmes: sortFacet(namedFacet(programmeFacet, 'Untitled programme')),
      themes: sortFacet(themeFacet),
      statuses: sortFacet(
        statusFacet.map((f) => ({
          value: f.value!,
          label: GRANT_STATUS_LABELS[f.value!] ?? f.value!,
          count: f.count,
        })),
      ),
      rounds: sortFacet(namedFacet(roundFacet, 'Untitled round')),
      regions: regionFacet_(regionFacet),
    },
  }
}

/**
 * Locations, alphabetical, with "No location recorded" pinned LAST rather than sorted
 * into the N's. It is not a place; it is the residue, and it belongs at the end of the
 * list for the same reason "Unattributed" does on the portfolio bar.
 */
function regionFacet_(
  rows: Array<{ value: string | null; label: string | null; count: number }>,
): FacetOption[] {
  const named = sortFacet(
    rows
      .filter((r): r is { value: string; label: string | null; count: number } => r.value !== null)
      .map((r) => ({ value: r.value, label: r.value, count: r.count })),
  )
  const unlocated = rows.find((r) => r.value === null)
  return unlocated
    ? [...named, { value: NO_REGION, label: 'No location recorded', count: unlocated.count }]
    : named
}

/**
 * A caller who can see nothing still gets the shape the screen expects — and the SAME
 * type, declared rather than inferred. Two structurally identical but distinct object
 * types make the server fn's return a union, and `.map()` over a union of array types
 * has no callable signature, so the screen's rows quietly become `any`.
 */
export function emptyAwardsList(): Awaited<ReturnType<typeof awardsList>> {
  return {
    items: [] as ReturnType<typeof toAwardRow>[],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totals: emptyGrantTotals(),
    facets: emptyFacets(),
  }
}

/** The row the register renders. Money arrives as `float8`; every consumer parsed it anyway. */
function toAwardRow(r: AwardGrantRow) {
  return {
    awardId: r.awardId,
    applicationId: r.applicationId,
    organisationName: r.organisationName,
    externalApplicationId: r.externalApplicationId,
    programmeName: r.programmeName,
    programmeColour: r.programmeColour,
    roundName: r.roundName,
    tags: (r.tags as string[] | null) ?? [],
    durationYears: r.durationYears,
    deliveryArea: r.deliveryArea,
    deliveryRegion: r.deliveryRegion,
    imported: r.imported,
    status: r.status,
    decisionAt: r.decisionAt,
    amountAwarded: r.amountAwarded,
    instalmentCount: r.instalmentCount,
    paidCount: r.paidCount,
    paidToDate: r.paidToDate,
    outstanding: r.outstanding,
  }
}

/** A facet row whose value is NULL (a grant with no programme) is not a facet. */
function namedFacet(
  rows: Array<{ value: string | null; label: string | null; count: number }>,
  fallback: string,
): FacetOption[] {
  return rows
    .filter((r): r is { value: string; label: string | null; count: number } => r.value !== null)
    .map((r) => ({ value: r.value, label: r.label ?? fallback, count: r.count }))
}

/** Facets read as a list, so they are alphabetical — the order `lib/facets` produced. */
function sortFacet(options: FacetOption[]): FacetOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Column sort, in SQL. Text sorts case-insensitively and NULLs go last whichever way
 * the arrow points — a grant with no delivery area is not "before A" or "after Z", it
 * is unranked. With no explicit sort the register's own order stands: most recently
 * awarded first.
 */
function awardOrderFor(
  g: AwardGrantsQuery,
  by: AwardSortKey | undefined,
  dir: 'asc' | 'desc' | undefined,
): SQL[] {
  const d = sql.raw(dir === 'asc' ? 'asc' : 'desc')
  const text = (col: SQLWrapper) => sql`lower(${col}) ${d} nulls last`
  switch (by) {
    case 'organisation':
      return [text(g.organisationName)]
    case 'programme':
      return [text(g.programmeName)]
    case 'round':
      return [text(g.roundName)]
    case 'geography':
      return [text(g.deliveryArea)]
    case 'awarded':
      return [sql`${g.decisionAt} ${d}`]
    case 'amount':
      return [sql`${g.amountAwarded} ${d}`]
    case 'paid':
      return [sql`${g.paidToDate} ${d}`]
    case 'duration':
      return [sql`${g.durationYears} ${d} nulls last`]
    // Lifecycle order, not alphabetical: live grants are the ones you act on.
    case 'status':
      return [sql`case ${g.status} when 'active' then 0 when 'completed' then 1 else 2 end ${d}`]
    default:
      return awardOrderFor(g, AWARDS_DEFAULT_SORT.by, AWARDS_DEFAULT_SORT.dir)
  }
}

/**
 * The order the register arrives in when nothing has been clicked — and, because the
 * table shows the sort arrow on whichever column `sort` names, also what the header
 * DRAWS on landing. It is one constant rather than two agreeing ones: the arrow used to
 * appear only after a click, so every list opened looking unsorted while being sorted.
 * The `default:` branch above routes through it, so the SQL cannot drift from the mark.
 */
export const AWARDS_DEFAULT_SORT = { by: 'awarded', dir: 'desc' } as const satisfies {
  by: AwardSortKey
  dir: 'asc' | 'desc'
}

/** Award lifecycle labels, shared by the facet and the client's status pill. */
export const GRANT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Complete',
  cancelled: 'Cancelled',
}

function emptyFacets() {
  return {
    programmes: [] as FacetOption[],
    themes: [] as FacetOption[],
    statuses: [] as FacetOption[],
    rounds: [] as FacetOption[],
    regions: [] as FacetOption[],
  }
}

function emptyGrantTotals() {
  return {
    totalAwarded: 0,
    count: 0,
    multiYearCount: 0,
    paidToDate: 0,
    outstanding: 0,
    byProgramme: [] as Array<{ name: string; amount: number; colour: string | null }>,
  }
}

// ─── Award detail (drill-down) ──────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The full picture of one award for its detail screen: the money (instalments,
// paid-to-date, outstanding), the reporting schedule and every report received, an
// aggregated impact figure, and a compact view of the source application. Everything
// is shaped into an explicitly serializable payload — raw rows carry loosely-typed
// jsonb the server-fn serializer rejects.
export const getAward = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.id),
      with: {
        application: {
          with: { roundProgramme: { with: { programme: true, round: true } } },
        },
        instalments: true,
        schedule: true,
        reports: true,
        letter: true,
      },
    })
    if (!award) throw notFoundError()
    assertClientAccess(user, award.clientId)

    const app = award.application
    const programme = app.roundProgramme?.programme ?? null
    const amountAwarded = parseFloat(award.amountAwarded)

    const instalments = [...award.instalments]
      .sort((a, b) => a.instalmentNo - b.instalmentNo)
      .map((p) => ({
        id: p.id,
        instalmentNo: p.instalmentNo,
        amount: parseFloat(p.amount),
        dueDate: p.dueDate,
        paidDate: p.paidDate,
        status: (p.paidDate ? 'paid' : dueStatus(p.dueDate)) as 'paid' | ScheduleStatus,
      }))
    const paidToDate = instalments.filter((p) => p.paidDate).reduce((s, p) => s + p.amount, 0)
    const scheduledTotal = instalments.reduce((s, p) => s + p.amount, 0)

    const reportingMilestones = [...award.schedule]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((m) => ({
        id: m.id,
        label: m.label,
        dueDate: m.dueDate,
        submittedDate: m.submittedDate,
        status: (m.submittedDate ? 'submitted' : dueStatus(m.dueDate)) as
          | 'submitted'
          | ScheduleStatus,
      }))

    const scheduleById = new Map(award.schedule.map((m) => [m.id, m]))
    const reportViews = [...award.reports]
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map((r) => ({
        id: r.id,
        // So the schedule can find the report behind a reporting date — the timeline's
        // key is the milestone id for a scheduled report, the report's own for the rest.
        scheduleId: r.scheduleId,
        label: reportLabel(
          r.scheduleId ? scheduleById.get(r.scheduleId)?.label : null,
          r.importBatchId !== null,
        ),
        submittedAt: r.submittedAt.toISOString(),
        status: (r.reviewedAt ? 'reviewed' : 'received') as 'received' | 'reviewed',
        impactSummary: r.impactSummary,
        aiSummary: r.aiSummary,
        applicationAlignment: r.applicationAlignment,
        programmeAlignment: r.programmeAlignment,
        impactQuantity: r.impactQuantity,
        impactUnitLabel: r.impactUnitLabel,
        // The report exactly as the grantee sent it, for the "Grant report" dialog the
        // View submissions card opens — the same fields, in the same order, as the
        // report screen's own View Report (`ReportFields`). Reading one is a glance at
        // what they wrote, and a glance should not cost a page.
        fields: {
          submittedAt: r.submittedAt.toISOString(),
          matchMethod: r.matchMethod,
          externalApplicationId: r.externalApplicationId,
          charityNumber: r.charityNumber,
          companyNumber: r.companyNumber,
          contactName: r.contactName,
          contactEmail: r.contactEmail,
          contactPhone: r.contactPhone,
          amountAwarded: r.amountAwarded,
          beneficiaryCount: r.beneficiaryCount,
          awardDate: r.awardDate,
          awardEndDate: r.awardEndDate,
          deliveryArea: r.deliveryArea,
          grantTitle: r.grantTitle,
          grantPurpose: r.grantPurpose,
          impactSummary: r.impactSummary,
          challenges: r.challenges,
          lessons: r.lessons,
          caseStudies: r.caseStudies,
          testimonials: r.testimonials,
          otherComments: r.otherComments,
          responses: (r.responses ?? []) as Array<{ label: string; value: string }>,
        },
      }))

    // Aggregate impact across this award's reports, in the programme's unit. Only
    // reports that actually evidenced a quantity contribute (never coerced to zero).
    const quantified = reportViews.filter((r) => r.impactQuantity != null)
    // The programme's unit as every other screen names it — `impactUnitLabel` resolves a
    // curated unit to its label, where the raw column is only set for a custom one.
    const unitLabel = programme
      ? impactUnitLabel(programme.impactUnit, programme.impactUnitLabel)
      : null
    const impact = {
      total: quantified.length
        ? quantified.reduce((s, r) => s + Number(r.impactQuantity), 0)
        : null,
      unitLabel: unitLabel ?? quantified[0]?.impactUnitLabel ?? null,
      reportCount: quantified.length,
    }

    // Every reporting date and every report, merged the way the report screen's
    // timeline merges them — the award screen's schedule is the same line, with the
    // controls on it. No report is "current" here; that marker is the report screen's.
    const reporting = reportingTimeline(
      // In date order: the relation comes back in whatever order Postgres found the rows,
      // and the View submissions card lists these as they come.
      [...award.schedule].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      award.reports.map((r) => ({
        id: r.id,
        scheduleId: r.scheduleId,
        submittedAt: r.submittedAt.toISOString(),
        importBatchId: r.importBatchId,
        impactQuantity: r.impactQuantity != null ? Number(r.impactQuantity) : null,
        impactUnitLabel: r.impactUnitLabel,
      })),
      { milestoneId: null, reportId: null },
    )

    const dep = app.deprivationContext
    const deprivation =
      app.deprivationStatus === 'resolved' && dep?.status === 'resolved'
        ? { min: dep.min, max: dep.max }
        : null

    // Two flags, because `finance` sits between the two: it may edit the payment
    // schedule but not the reporting milestones (whose fns are admin-only).
    const canEdit = user.role === 'superadmin' || user.role === 'admin'
    const canEditPayments = canEdit || user.role === 'finance'

    return {
      id: award.id,
      status: award.status,
      amountAwarded,
      purpose: award.purpose,
      specialCondition: award.specialCondition,
      startDate: award.startDate,
      // The award letter as issued — a stored snapshot, not a re-render (see the
      // `award_letters` table comment).
      letter: award.letter
        ? {
            subject: award.letter.subject,
            bodyText: award.letter.bodyText,
            status: award.letter.status,
            recipientEmail: award.letter.recipientEmail,
            replyTo: award.letter.replyTo,
            failureReason: award.letter.failureReason,
            sentAt: award.letter.sentAt?.toISOString() ?? null,
          }
        : null,
      decisionAt: award.decisionAt.toISOString(),
      durationYears: app.roundProgramme?.grantDurationYears ?? null,
      organisationName: app.organisationName,
      programmeName: programme?.name ?? null,
      roundName: app.roundProgramme?.round?.name ?? null,
      deliveryArea: deliveryAreaLabel(app),
      impactUnitLabel: unitLabel,
      themes: (programme?.tags as string[] | null) ?? [],
      // What the grant set out to reach, for the whole grant — the award's impact total
      // is read against it.
      proposedImpact:
        app.proposedImpactQuantity != null ? Number(app.proposedImpactQuantity) : null,
      deprivation,
      instalments,
      paidToDate,
      outstanding: amountAwarded - paidToDate,
      scheduledTotal,
      instalmentCount: instalments.length,
      paidCount: instalments.filter((p) => p.paidDate).length,
      reportingMilestones,
      reporting,
      reports: reportViews,
      impact,
      application: {
        id: app.id,
        amountRequested: parseFloat(app.amountRequested),
        // The applicant's own sentence, shown only where the award recorded none
        // (awards minted before `awards.purpose` existed) — as the report screen does.
        grantPurpose: app.grantPurpose,
        custodianScore: app.custodianScore,
        custodianScoreStatus: app.custodianScoreStatus,
        custodianScoreSummary: app.custodianScoreDetail?.summary ?? null,
        charityNumber: app.charityNumber,
        companyNumber: app.companyNumber,
        externalApplicationId: app.externalApplicationId,
        deliveryArea: app.deliveryArea,
        submittedAt: app.submittedAt.toISOString(),
        // The application exactly as it was sent, for the "Application form" dialog the
        // View submissions card opens — what `ApplicationFields` renders on the
        // application screen. The bank columns are withheld from roles that cannot see
        // the payment schedule, as `getApplication` withholds them.
        fields: {
          externalApplicationId: app.externalApplicationId,
          organisationName: app.organisationName,
          organisationSummary: app.organisationSummary,
          applicantEmail: app.applicantEmail,
          charityNumber: app.charityNumber,
          companyNumber: app.companyNumber,
          deliveryArea: app.deliveryArea,
          amountRequested: app.amountRequested,
          unrestrictedReserves: app.unrestrictedReserves,
          proposedImpactQuantity: app.proposedImpactQuantity,
          budgetBreakdown: app.budgetBreakdown,
          budgetBreakdownLink: app.budgetBreakdownLink,
          ...(canSeePayments(user.role)
            ? {
                bankName: app.bankName,
                bankAccountName: app.bankAccountName,
                bankAccountNumber: app.bankAccountNumber,
                bankSortCode: app.bankSortCode,
              }
            : {
                bankName: null,
                bankAccountName: null,
                bankAccountNumber: null,
                bankSortCode: null,
              }),
          responses: app.responses,
          submittedFields: app.submittedFields,
        },
      },
      canEdit,
      canEditPayments,
    }
  })

// Resolve an award by one of its child rows (instalment / report milestone), asserting
// the caller may manage it. Returns the owning award's id + clientId.
async function requireAwardForSchedule(
  user: Awaited<ReturnType<typeof requireRole>>,
  scheduleId: string,
) {
  const row = await getDb().query.reportSchedule.findFirst({
    where: eq(reportSchedule.id, scheduleId),
    with: { award: { columns: { id: true, clientId: true, applicationId: true } } },
  })
  if (!row) throw notFoundError()
  assertClientAccess(user, row.award.clientId)
  return row
}

const ReportMilestoneSchema = z.object({
  label: z.string().trim().min(1).max(200),
  dueDate: z.string().regex(ISO_DATE, 'Expected yyyy-mm-dd'),
})

// Add a reporting milestone to an award.
export const addReportMilestone = createServerFn({ method: 'POST' })
  .validator(ReportMilestoneSchema.extend({ awardId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.awardId),
      columns: { id: true, clientId: true, applicationId: true },
    })
    if (!award) throw notFoundError()
    assertClientAccess(user, award.clientId)
    await getDb()
      .insert(reportSchedule)
      .values({ awardId: data.awardId, label: data.label, dueDate: data.dueDate })

    // A date nobody has answered yet reopens a grant that had been marked complete.
    await recomputeAwardStatus(award.id)

    await recordAudit({
      actorUserId: user.id,
      action: 'grant_report_milestone_added',
      applicationId: award.applicationId,
      clientId: award.clientId,
      metadata: { label: data.label, dueDate: data.dueDate },
    })
  })

// Edit a reporting milestone's label and/or due date.
export const updateReportMilestone = createServerFn({ method: 'POST' })
  .validator(ReportMilestoneSchema.extend({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const row = await requireAwardForSchedule(user, data.id)
    await getDb()
      .update(reportSchedule)
      .set({ label: data.label, dueDate: data.dueDate })
      .where(eq(reportSchedule.id, data.id))

    // Both sides are logged: "moved from March to September" is the answer somebody
    // will want, and the row itself only ever holds the date it ended up at.
    await recordAudit({
      actorUserId: user.id,
      action: 'grant_report_milestone_changed',
      applicationId: row.award.applicationId,
      clientId: row.award.clientId,
      metadata: {
        from: { label: row.label, dueDate: row.dueDate },
        to: { label: data.label, dueDate: data.dueDate },
      },
    })
  })

// Remove a reporting milestone. Refused once a report has been logged against it —
// that would orphan a received document's schedule link.
export const deleteReportMilestone = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const row = await requireAwardForSchedule(user, data.id)
    if (row.submittedDate) {
      throw conflict('This report has already been received and cannot be removed')
    }
    await getDb().delete(reportSchedule).where(eq(reportSchedule.id, data.id))

    // Dropping the last thing still expected can be what finishes the grant. (Only an
    // unanswered date reaches here — the guard above refuses a received one.)
    await recomputeAwardStatus(row.award.id)

    await recordAudit({
      actorUserId: user.id,
      action: 'grant_report_milestone_removed',
      applicationId: row.award.applicationId,
      clientId: row.award.clientId,
      metadata: { label: row.label, dueDate: row.dueDate },
    })
  })

// Edit an instalment's amount and/or due date (null dueDate = date TBC).
export const updateInstalment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      amount: z.number().positive().optional(),
      dueDate: z.string().regex(ISO_DATE).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    // `finance` may move money around the schedule but never decides grants —
    // the award/decline/shortlist fns above stay admin-only.
    const user = await requireRole('superadmin', 'admin', 'finance')
    const row = await getDb().query.awardInstalments.findFirst({
      where: eq(awardInstalments.id, data.id),
      with: { award: { columns: { clientId: true, applicationId: true } } },
    })
    if (!row) throw notFoundError()
    assertClientAccess(user, row.award.clientId)
    await getDb()
      .update(awardInstalments)
      .set({
        ...(data.amount !== undefined ? { amount: data.amount.toString() } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      })
      .where(eq(awardInstalments.id, data.id))

    // Rescheduling money is the same class of act as ticking it off, so it is recorded
    // the same way — with both sides, since the row keeps only where it landed. Fields
    // the caller left alone are omitted rather than logged as unchanged.
    await recordAudit({
      actorUserId: user.id,
      action: 'grant_payment_amended',
      applicationId: row.award.applicationId,
      clientId: row.award.clientId,
      metadata: {
        instalmentNo: row.instalmentNo,
        ...(data.amount !== undefined ? { amount: { from: row.amount, to: data.amount } } : {}),
        ...(data.dueDate !== undefined ? { dueDate: { from: row.dueDate, to: data.dueDate } } : {}),
      },
    })
  })

// Mark an instalment paid (records today, or an explicit date) or clear it back to
// outstanding. Paying the final instalment auto-completes the award ("Complete");
// reopening a paid instalment on a completed award flips it back to active. A
// cancelled award is never touched — the award's lifecycle simply tracks whether
// the money is fully out the door.
export const setInstalmentPaid = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      paid: z.boolean(),
      paidDate: z.string().regex(ISO_DATE).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'finance')
    const row = await getDb().query.awardInstalments.findFirst({
      where: eq(awardInstalments.id, data.id),
      with: {
        award: {
          columns: { id: true, clientId: true, status: true, applicationId: true },
        },
      },
    })
    if (!row) throw notFoundError()
    assertClientAccess(user, row.award.clientId)
    const paidDate = data.paid ? (data.paidDate ?? new Date().toISOString().slice(0, 10)) : null
    await getDb().update(awardInstalments).set({ paidDate }).where(eq(awardInstalments.id, data.id))

    // The instalment row now holds the date the money went; this is the only record of
    // who said it went and when they said so. Written after the update, so the log
    // never claims a payment the schedule doesn't show — `recordAudit` swallows its own
    // failures, so an audit problem can never block the payment itself.
    //
    // `data.paidDate` is deliberately not what goes in the metadata: `paidDate` above is
    // the date actually written (today, when the caller didn't name one).
    await recordAudit({
      actorUserId: user.id,
      action: data.paid ? 'grant_payment_recorded' : 'grant_payment_reversed',
      applicationId: row.award.applicationId,
      clientId: row.award.clientId,
      metadata: {
        instalmentNo: row.instalmentNo,
        amount: row.amount,
        // On a reversal this is the date being taken back, not one being set.
        paidDate: data.paid ? paidDate : row.paidDate,
      },
    })

    // Paying the last instalment does not by itself finish a grant — the reporting has
    // to be back and read too. See `src/lib/awardCompletion.ts`.
    await recomputeAwardStatus(row.award.id)
  })
