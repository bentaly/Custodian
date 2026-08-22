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
  ilike,
  gte,
  lt,
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
} from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
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
import { facetBy, facetByMany, type FacetOption } from '../../lib/facets'
import { paginate, PAGE_SIZE } from '../../lib/pagination'
import { sortRows } from '../../lib/sortRows'
import {
  filterWhere as awardFilterWhere,
  grantsQuery as awardGrantsQuery,
  type GrantRow as AwardGrantRow,
  type GrantsQuery as AwardGrantsQuery,
} from '../awards/query'

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

    const scoreBandFilter = (() => {
      switch (filters.scoreBand) {
        case '90plus':
          return gte(applications.custodianScore, 90)
        case '80to89':
          return and(gte(applications.custodianScore, 80), lt(applications.custodianScore, 90))
        case '70to79':
          return and(gte(applications.custodianScore, 70), lt(applications.custodianScore, 80))
        case 'below70':
          return and(isNotNull(applications.custodianScore), lt(applications.custodianScore, 70))
        default:
          return undefined
      }
    })()

    // Everything except the status filter — used both for the status-tab counts
    // (so each tab reflects the other active filters) and as the base of `where`.
    // The date window is inclusive of both calendar days, so `to` runs to the end
    // of that day rather than to midnight at its start.
    const baseWhere = and(
      roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
      filters.q ? ilike(applications.organisationName, `%${filters.q}%`) : undefined,
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

    // Committed = awarded awards at their grant amount + shortlisted at requested.
    const committedRows = await getDb()
      .select({
        committed: sql<
          string | null
        >`SUM(COALESCE(${awards.amountAwarded}, ${applications.amountRequested}))`,
      })
      .from(applications)
      .leftJoin(awards, eq(awards.applicationId, applications.id))
      .where(
        and(
          eq(applications.roundProgrammeId, application.roundProgrammeId),
          inArray(applications.status, ['shortlisted', 'awarded']),
        ),
      )
    const committed = committedRows[0]?.committed

    return { ...application, roundProgrammeCommitted: committed ? parseFloat(committed) : 0 }
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
      amountRequested: Number(application.amountRequested),
    })

    const [updated] = await getDb()
      .update(applications)
      .set({
        ...(supplied ? { charityNumber, companyNumber } : {}),
        dueDiligenceStatus: result.status,
        dueDiligenceChecks: result.checks,
        dueDiligenceCheckedAt: new Date(result.checkedAt),
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

    if (status === 'shortlisted') {
      const app = await getDb().query.applications.findFirst({
        where: (a, { eq }) => eq(a.id, id),
        with: { roundProgramme: true },
      })
      if (!app) throw notFoundError()

      const budget = app.roundProgramme.budget ? parseFloat(app.roundProgramme.budget) : null
      if (budget !== null) {
        const currentRows = await getDb()
          .select({
            current: sql<
              string | null
            >`SUM(COALESCE(${awards.amountAwarded}, ${applications.amountRequested}))`,
          })
          .from(applications)
          .leftJoin(awards, eq(awards.applicationId, applications.id))
          .where(
            and(
              eq(applications.roundProgrammeId, app.roundProgrammeId),
              inArray(applications.status, ['shortlisted', 'awarded']),
              ne(applications.id, id),
            ),
          )

        const committed = currentRows[0]?.current ? parseFloat(currentRows[0].current) : 0
        const requested = parseFloat(app.amountRequested)
        if (committed + requested > budget) {
          const fmt = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
          const remaining = budget - committed
          throw conflict(
            `Budget limit reached — ${fmt(remaining > 0 ? remaining : 0)} remaining, this application requests ${fmt(requested)}`,
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

    const roundProgrammeIds = intersectScope(await visibleRoundProgrammeIds(user), contextIds)
    // An empty scope is a caller who can see nothing; `inArray(x, [])` is a SQL error,
    // so it never reaches the query.
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) return emptyAwardsList()
    return awardsList(getDb(), roundProgrammeIds, data)
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

/**
 * The Awards register, as a plain function of (connection, tenant scope, filters) —
 * the same seam Finance has, so everything below the auth check can be run without a
 * session, by a script against staging or by a test.
 *
 * Rows, the count, the KPI totals, the portfolio split and all four facets go out as
 * ONE `db.batch()`: one round trip, one snapshot, so a KPI cannot disagree with the
 * table beneath it.
 */
export async function awardsList(
  db: ReturnType<typeof getDb>,
  scope: string[] | undefined,
  data: AwardsListInput,
) {
  const g = awardGrantsQuery(db, scope)
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
    db
      .select({
        totalAwarded: sql<number>`coalesce(sum(${g.amountAwarded}), 0)::float8`,
        count: sql<number>`(count(*))::int`,
        multiYearCount: sql<number>`(count(*) filter (where ${g.durationYears} > 1))::int`,
        paidToDate: sql<number>`coalesce(sum(${g.paidToDate}), 0)::float8`,
        outstanding: sql<number>`coalesce(sum(${g.outstanding}), 0)::float8`,
      })
      .from(g)
      .where(where),
    // The portfolio split, grouped by programme NAME: a grant whose programme was
    // deleted still spent money, and it is read under one heading rather than
    // disappearing from the bar. Each keeps its own colour, so the bar speaks the
    // same vocabulary as the programme cards.
    db
      .select({
        name: sql<string>`coalesce(${g.programmeName}, 'Unattributed')`,
        colour: sql<string | null>`max(${g.programmeColour})`,
        amount: sql<number>`coalesce(sum(${g.amountAwarded}), 0)::float8`,
      })
      .from(g)
      .where(where)
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
    },
  }
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
        label:
          (r.scheduleId ? scheduleById.get(r.scheduleId)?.label : null) ?? 'Unscheduled report',
        submittedAt: r.submittedAt.toISOString(),
        status: (r.reviewedAt ? 'reviewed' : 'received') as 'received' | 'reviewed',
        impactSummary: r.impactSummary,
        aiSummary: r.aiSummary,
        applicationAlignment: r.applicationAlignment,
        programmeAlignment: r.programmeAlignment,
        impactQuantity: r.impactQuantity,
        impactUnitLabel: r.impactUnitLabel,
      }))

    // Aggregate impact across this award's reports, in the programme's unit. Only
    // reports that actually evidenced a quantity contribute (never coerced to zero).
    const quantified = reportViews.filter((r) => r.impactQuantity != null)
    const impact = {
      total: quantified.length
        ? quantified.reduce((s, r) => s + Number(r.impactQuantity), 0)
        : null,
      unitLabel: programme?.impactUnitLabel ?? quantified[0]?.impactUnitLabel ?? null,
      reportCount: quantified.length,
    }

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
      deliveryArea: app.deliveryRegion ?? app.deliveryArea ?? null,
      impactUnitLabel: programme?.impactUnitLabel ?? null,
      instalments,
      paidToDate,
      outstanding: amountAwarded - paidToDate,
      scheduledTotal,
      instalmentCount: instalments.length,
      paidCount: instalments.filter((p) => p.paidDate).length,
      reportingMilestones,
      reports: reportViews,
      impact,
      application: {
        id: app.id,
        amountRequested: parseFloat(app.amountRequested),
        custodianScore: app.custodianScore,
        custodianScoreStatus: app.custodianScoreStatus,
        charityNumber: app.charityNumber,
        companyNumber: app.companyNumber,
        externalApplicationId: app.externalApplicationId,
        deliveryArea: app.deliveryArea,
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

    // Re-derive the award's lifecycle from its instalments. Only 'active' ⇄
    // 'completed' is automated here; 'cancelled' is a deliberate manual state.
    if (row.award.status !== 'cancelled') {
      const siblings = await getDb()
        .select({ paidDate: awardInstalments.paidDate })
        .from(awardInstalments)
        .where(eq(awardInstalments.awardId, row.award.id))
      const allPaid = siblings.length > 0 && siblings.every((s) => s.paidDate)
      const nextStatus = allPaid ? 'completed' : 'active'
      if (nextStatus !== row.award.status) {
        await getDb().update(awards).set({ status: nextStatus }).where(eq(awards.id, row.award.id))
      }
    }
  })
