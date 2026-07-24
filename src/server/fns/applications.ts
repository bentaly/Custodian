import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, count, inArray, sql, ne, ilike, gte, lt, isNotNull, desc } from 'drizzle-orm'
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
import { assertApplicationAccess, assertClientAccess, intersectScope, visibleRoundProgrammeIds } from '../scope'
import {
  ApplicationFiltersSchema,
  CreateApplicationSchema,
  GenerateAwardSchema,
  UpdateApplicationStatusSchema,
} from '../../lib/validators/application'
import { runDueDiligence } from '../dueDiligence/run'
import { runCustodianScore } from '../custodianScore/run'
import { resolveDeprivation } from '../deprivation/run'
import { deliveryGeoFromResult } from '../../lib/deprivation/types'

export const listApplications = createServerFn({ method: 'GET' })
  .inputValidator(ApplicationFiltersSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const { page, pageSize, ...filters } = data

    let filterIds: string[] | undefined
    if (filters.roundId || filters.programmeId || filters.tag) {
      // Tag lives on the programme (jsonb array), so resolve it by joining programmes.
      const conds = and(
        filters.roundId ? eq(roundProgrammes.roundId, filters.roundId) : undefined,
        filters.programmeId ? eq(roundProgrammes.programmeId, filters.programmeId) : undefined,
        filters.tag ? sql`${programmes.tags} @> ${JSON.stringify([filters.tag])}::jsonb` : undefined,
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
    const baseWhere = and(
      roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
      filters.q ? ilike(applications.organisationName, `%${filters.q}%`) : undefined,
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
    const orderBy = sortExpr ? [sortExpr, desc(applications.submittedAt)] : [desc(applications.submittedAt)]

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
    ]).catch((err) => { console.error('listApplications DB error:', err?.cause ?? err); throw err })

    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.count]))
    const allCount = statusRows.reduce((s, r) => s + r.count, 0)

    return { items, total: totals[0]?.total ?? 0, page, pageSize, statusCounts, allCount }
  })

export const getApplication = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: {
        roundProgramme: { with: { programme: { with: { client: true } }, round: true } },
      },
    })
    if (!application) throw new Error('Not found')
    assertClientAccess(user, application.roundProgramme.programme.clientId)

    // Committed = awarded awards at their grant amount + shortlisted at requested.
    const committedRows = await getDb()
      .select({
        committed: sql<string | null>`SUM(COALESCE(${awards.amountAwarded}, ${applications.amountRequested}))`,
      })
      .from(applications)
      .leftJoin(awards, eq(awards.applicationId, applications.id))
      .where(and(
        eq(applications.roundProgrammeId, application.roundProgrammeId),
        inArray(applications.status, ['shortlisted', 'awarded']),
      ))
    const committed = committedRows[0]?.committed

    return { ...application, roundProgrammeCommitted: committed ? parseFloat(committed) : 0 }
  })

export const createApplication = createServerFn({ method: 'POST' })
  .inputValidator(CreateApplicationSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const { amountRequested, proposedImpactQuantity, ...rest } = data

    // The roundProgramme determines the owning client; reject one outside it.
    const rp = await getDb().query.roundProgrammes.findFirst({
      where: (r, { eq }) => eq(r.id, rest.roundProgrammeId),
      with: { programme: { columns: { clientId: true } } },
    })
    if (!rp) throw new Error('Not found')
    assertClientAccess(user, rp.programme.clientId)

    const id = crypto.randomUUID()

    await getDb().insert(applications).values({
      id,
      ...rest,
      amountRequested: amountRequested.toString(),
      proposedImpactQuantity: proposedImpactQuantity != null ? proposedImpactQuantity.toString() : null,
    })

    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, id),
    })
    return application!
  })

export const rerunDueDiligence = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    await assertApplicationAccess(user, data.id)

    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
    })
    if (!application) throw new Error('Not found')

    const result = await runDueDiligence({
      charityNumber: application.charityNumber,
      companyNumber: application.companyNumber,
      amountRequested: Number(application.amountRequested),
    })

    const [updated] = await getDb()
      .update(applications)
      .set({
        dueDiligenceStatus: result.status,
        dueDiligenceChecks: result.checks,
        dueDiligenceCheckedAt: new Date(result.checkedAt),
      })
      .where(eq(applications.id, data.id))
      .returning()
    return updated!
  })

export const rerunCustodianScore = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    await assertApplicationAccess(user, data.id)

    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: {
        roundProgramme: { with: { programme: { with: { client: { with: { profile: true } } } } } },
      },
    })
    if (!application) throw new Error('Not found')

    const programme = application.roundProgramme.programme
    const result = await runCustodianScore({
      missionStatement: programme.client.profile?.missionStatement,
      programmeName: programme.name,
      programmeGoal: programme.goal,
      programmeDescription: programme.description,
      organisationName: application.organisationName,
      amountRequested: Number(application.amountRequested),
      budgetBreakdown: application.budgetBreakdown,
      deliveryArea: application.deliveryArea,
      charityNumber: application.charityNumber,
      companyNumber: application.companyNumber,
      responses: application.responses,
    })

    const [updated] = await getDb()
      .update(applications)
      .set({
        custodianScoreStatus: result.status,
        custodianScore: result.score,
        custodianScoreDetail: result.detail,
        custodianScoredAt: new Date(result.scoredAt),
      })
      .where(eq(applications.id, data.id))
      .returning()
    return updated!
  })

// Re-resolve the deprivation context from the application's delivery area. Used by the
// details-page "Re-run" button (e.g. after a staff member corrects the location) and by
// the backfill script for applications created before this existed.
export const rerunDeprivation = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid(), deliveryArea: z.string().max(255).optional() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    await assertApplicationAccess(user, data.id)

    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
    })
    if (!application) throw new Error('Not found')

    // An optional override lets staff correct a mis-stated location in place.
    const location = data.deliveryArea ?? application.deliveryArea
    const result = await resolveDeprivation(location)
    const attempted = result.status !== 'pending'
    const geo = deliveryGeoFromResult(result)

    const [updated] = await getDb()
      .update(applications)
      .set({
        // Persist the corrected location too, when one was supplied.
        ...(data.deliveryArea !== undefined ? { deliveryArea: data.deliveryArea } : {}),
        deprivationStatus: result.status,
        deprivationContext: attempted ? result : null,
        deprivationResolvedAt: attempted ? new Date() : null,
        deliveryNation: geo.nation,
        deliveryRegion: geo.region,
        deliveryLadCode: geo.ladCode,
        deliveryLadName: geo.ladName,
      })
      .where(eq(applications.id, data.id))
      .returning()
    return updated!
  })

export const generateAward = createServerFn({ method: 'POST' })
  .inputValidator(GenerateAwardSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    await assertApplicationAccess(user, data.id)

    // An award can only be generated for a shortlisted application that has secured
    // a majority (> 50%) of its client's trustees voting in favour.
    const existing = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: { roundProgramme: { with: { programme: true } } },
    })
    if (!existing) throw new Error('Not found')
    if (existing.status !== 'shortlisted') {
      throw new Error('Only shortlisted applications can be awarded')
    }

    const clientId = existing.roundProgramme.programme.clientId
    const [trusteeRows, yesRows] = await Promise.all([
      getDb()
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId))),
      getDb()
        .select({ count: count() })
        .from(applicationVotes)
        .where(and(eq(applicationVotes.applicationId, data.id), eq(applicationVotes.vote, 'yes'))),
    ])
    const trusteeCount = trusteeRows[0]?.count ?? 0
    const yesCount = yesRows[0]?.count ?? 0
    if (trusteeCount === 0 || yesCount * 2 <= trusteeCount) {
      throw new Error(
        'A majority of trustees must vote in favour before an award can be generated',
      )
    }

    const decisionAt = new Date()

    // Promote the award to a first-class grant: the money/schedule live on `awards` /
    // `grant_payments` and the reporting milestones on `grant_reports`. The application
    // stays the request record and only flips status.
    const awardId = crypto.randomUUID()
    await getDb().insert(awards).values({
      id: awardId,
      applicationId: data.id,
      clientId,
      amountAwarded: data.amountAwarded.toString(),
      status: 'active',
      decisionAt,
    })
    await getDb()
      .insert(awardInstalments)
      .values(
        data.schedule.map((s) => ({
          awardId,
          instalmentNo: s.instalment,
          amount: s.amount.toString(),
          dueDate: s.date,
        })),
      )
    if (data.reportingDates.length > 0) {
      await getDb()
        .insert(reportSchedule)
        .values(
          data.reportingDates.map((r) => ({
            awardId,
            label: r.label,
            dueDate: r.date,
          })),
        )
    }

    const [application] = await getDb()
      .update(applications)
      .set({
        status: 'awarded',
        decisionAt,
      })
      .where(eq(applications.id, data.id))
      .returning()
    if (!application) throw new Error('Not found')

    await recordAudit({
      actorUserId: user.id,
      action: 'application_awarded',
      applicationId: data.id,
      clientId,
      metadata: { amount: data.amountAwarded },
    })
    return application
  })

export const getRoundBudgetSummary = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roundId: z.uuid() }))
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
        .where(and(
          inArray(applications.roundProgrammeId, rpIds),
          inArray(applications.status, ['shortlisted', 'awarded']),
        ))
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
  .inputValidator(UpdateApplicationStatusSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const { id, status } = data
    await assertApplicationAccess(user, id)

    if (status === 'shortlisted') {
      const app = await getDb().query.applications.findFirst({
        where: (a, { eq }) => eq(a.id, id),
        with: { roundProgramme: true },
      })
      if (!app) throw new Error('Not found')

      const budget = app.roundProgramme.budget ? parseFloat(app.roundProgramme.budget) : null
      if (budget !== null) {
        const currentRows = await getDb()
          .select({
            current: sql<string | null>`SUM(COALESCE(${awards.amountAwarded}, ${applications.amountRequested}))`,
          })
          .from(applications)
          .leftJoin(awards, eq(awards.applicationId, applications.id))
          .where(and(
            eq(applications.roundProgrammeId, app.roundProgrammeId),
            inArray(applications.status, ['shortlisted', 'awarded']),
            ne(applications.id, id),
          ))

        const committed = currentRows[0]?.current ? parseFloat(currentRows[0].current) : 0
        const requested = parseFloat(app.amountRequested)
        if (committed + requested > budget) {
          const fmt = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
          const remaining = budget - committed
          throw new Error(
            `Budget limit reached — ${fmt(remaining > 0 ? remaining : 0)} remaining, this application requests ${fmt(requested)}`
          )
        }
      }
    }

    const decisionStatuses = ['awarded', 'declined'] as const
    const isDecision = decisionStatuses.includes(status as (typeof decisionStatuses)[number])

    const [application] = await getDb()
      .update(applications)
      .set({
        status,
        ...(isDecision && { decisionAt: new Date() }),
      })
      .where(eq(applications.id, id))
      .returning()

    // Log the interesting human decisions. Awards are logged in `generateAward`
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
  .inputValidator(
    z.object({
      roundId: z.uuid().optional(),
      programmeId: z.uuid().optional(),
      tag: z.string().min(1).max(100).optional(),
      q: z.string().trim().min(1).max(255).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    // Resolve the round/programme/tag filter to a set of round-programme ids, exactly
    // as listApplications does (tag lives on the programme jsonb).
    let filterIds: string[] | undefined
    if (data.roundId || data.programmeId || data.tag) {
      const conds = and(
        data.roundId ? eq(roundProgrammes.roundId, data.roundId) : undefined,
        data.programmeId ? eq(roundProgrammes.programmeId, data.programmeId) : undefined,
        data.tag ? sql`${programmes.tags} @> ${JSON.stringify([data.tag])}::jsonb` : undefined,
      )
      const rows = data.tag
        ? await getDb()
            .select({ id: roundProgrammes.id })
            .from(roundProgrammes)
            .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
            .where(conds)
        : await getDb().select({ id: roundProgrammes.id }).from(roundProgrammes).where(conds)
      filterIds = rows.map((r) => r.id)
    }

    const roundProgrammeIds = intersectScope(await visibleRoundProgrammeIds(user), filterIds)
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) {
      return { items: [], totals: emptyGrantTotals() }
    }

    const apps = await getDb().query.applications.findMany({
      where: and(
        eq(applications.status, 'awarded'),
        roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
        data.q ? ilike(applications.organisationName, `%${data.q}%`) : undefined,
      ),
      with: {
        roundProgramme: { with: { programme: true, round: true } },
        award: { with: { instalments: true } },
      },
      orderBy: (a, { desc }) => [desc(a.decisionAt)],
    })

    // An awarded application without an award row hasn't been backfilled yet; skip it
    // rather than guess an amount.
    const items = apps
      .filter((a) => a.award)
      .map((a) => {
        const award = a.award!
        const amountAwarded = parseFloat(award.amountAwarded)
        const paidToDate = award.instalments
          .filter((p) => p.paidDate)
          .reduce((s, p) => s + parseFloat(p.amount), 0)
        return {
          awardId: award.id,
          applicationId: a.id,
          organisationName: a.organisationName,
          programmeName: a.roundProgramme?.programme?.name ?? null,
          roundName: a.roundProgramme?.round?.name ?? null,
          tags: (a.roundProgramme?.programme?.tags as string[] | null) ?? [],
          durationYears: a.roundProgramme?.grantDurationYears ?? null,
          deliveryArea: a.deliveryRegion ?? a.deliveryArea ?? null,
          status: award.status,
          decisionAt: award.decisionAt,
          amountAwarded,
          instalmentCount: award.instalments.length,
          paidCount: award.instalments.filter((p) => p.paidDate).length,
          paidToDate,
          outstanding: amountAwarded - paidToDate,
        }
      })

    const byProgrammeMap = new Map<string, number>()
    for (const it of items) {
      const key = it.programmeName ?? 'Unattributed'
      byProgrammeMap.set(key, (byProgrammeMap.get(key) ?? 0) + it.amountAwarded)
    }

    const totals = {
      totalAwarded: items.reduce((s, i) => s + i.amountAwarded, 0),
      count: items.length,
      multiYearCount: items.filter((i) => (i.durationYears ?? 0) > 1).length,
      paidToDate: items.reduce((s, i) => s + i.paidToDate, 0),
      outstanding: items.reduce((s, i) => s + i.outstanding, 0),
      byProgramme: [...byProgrammeMap.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    }

    return { items, totals }
  })

function emptyGrantTotals() {
  return {
    totalAwarded: 0,
    count: 0,
    multiYearCount: 0,
    paidToDate: 0,
    outstanding: 0,
    byProgramme: [] as Array<{ name: string; amount: number }>,
  }
}

// ─── Award detail (drill-down) ──────────────────────────────────────────────────

const DUE_SOON_DAYS = 30
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Timeline status of a dated milestone/instalment (payment or report). */
export type ScheduleStatus = 'tbc' | 'overdue' | 'due_soon' | 'upcoming'

function dueStatus(dueDate: string | null): ScheduleStatus {
  if (!dueDate) return 'tbc'
  const due = new Date(dueDate).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now <= DUE_SOON_DAYS * 24 * 60 * 60 * 1000) return 'due_soon'
  return 'upcoming'
}

// The full picture of one award for its detail screen: the money (instalments,
// paid-to-date, outstanding), the reporting schedule and every report received, an
// aggregated impact figure, and a compact view of the source application. Everything
// is shaped into an explicitly serializable payload — raw rows carry loosely-typed
// jsonb the server-fn serializer rejects.
export const getAward = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.uuid() }))
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
      },
    })
    if (!award) throw new Error('Not found')
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
        status: (m.submittedDate ? 'submitted' : dueStatus(m.dueDate)) as 'submitted' | ScheduleStatus,
      }))

    const scheduleById = new Map(award.schedule.map((m) => [m.id, m]))
    const reportViews = [...award.reports]
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map((r) => ({
        id: r.id,
        label: (r.scheduleId ? scheduleById.get(r.scheduleId)?.label : null) ?? 'Unscheduled report',
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

    const canEdit = user.role === 'superadmin' || user.role === 'admin' || user.role === 'manager'

    return {
      id: award.id,
      status: award.status,
      amountAwarded,
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
    with: { award: { columns: { id: true, clientId: true } } },
  })
  if (!row) throw new Error('Not found')
  assertClientAccess(user, row.award.clientId)
  return row
}

const ReportMilestoneSchema = z.object({
  label: z.string().trim().min(1).max(200),
  dueDate: z.string().regex(ISO_DATE, 'Expected yyyy-mm-dd'),
})

// Add a reporting milestone to an award.
export const addReportMilestone = createServerFn({ method: 'POST' })
  .inputValidator(ReportMilestoneSchema.extend({ awardId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.awardId),
      columns: { id: true, clientId: true },
    })
    if (!award) throw new Error('Not found')
    assertClientAccess(user, award.clientId)
    await getDb()
      .insert(reportSchedule)
      .values({ awardId: data.awardId, label: data.label, dueDate: data.dueDate })
  })

// Edit a reporting milestone's label and/or due date.
export const updateReportMilestone = createServerFn({ method: 'POST' })
  .inputValidator(ReportMilestoneSchema.extend({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    await requireAwardForSchedule(user, data.id)
    await getDb()
      .update(reportSchedule)
      .set({ label: data.label, dueDate: data.dueDate })
      .where(eq(reportSchedule.id, data.id))
  })

// Remove a reporting milestone. Refused once a report has been logged against it —
// that would orphan a received document's schedule link.
export const deleteReportMilestone = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const row = await requireAwardForSchedule(user, data.id)
    if (row.submittedDate) {
      throw new Error('This report has already been received and cannot be removed')
    }
    await getDb().delete(reportSchedule).where(eq(reportSchedule.id, data.id))
  })

// Edit an instalment's amount and/or due date (null dueDate = date TBC).
export const updateInstalment = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.uuid(),
      amount: z.number().positive().optional(),
      dueDate: z.string().regex(ISO_DATE).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const row = await getDb().query.awardInstalments.findFirst({
      where: eq(awardInstalments.id, data.id),
      with: { award: { columns: { clientId: true } } },
    })
    if (!row) throw new Error('Not found')
    assertClientAccess(user, row.award.clientId)
    await getDb()
      .update(awardInstalments)
      .set({
        ...(data.amount !== undefined ? { amount: data.amount.toString() } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      })
      .where(eq(awardInstalments.id, data.id))
  })

// Mark an instalment paid (records today, or an explicit date) or clear it back to
// outstanding. Paying the final instalment auto-completes the award ("Done");
// reopening a paid instalment on a completed award flips it back to active. A
// cancelled award is never touched. (Until a dedicated Finance section owns this,
// the award's lifecycle simply tracks whether the money is fully out the door.)
export const setInstalmentPaid = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.uuid(),
      paid: z.boolean(),
      paidDate: z.string().regex(ISO_DATE).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const row = await getDb().query.awardInstalments.findFirst({
      where: eq(awardInstalments.id, data.id),
      with: { award: { columns: { id: true, clientId: true, status: true } } },
    })
    if (!row) throw new Error('Not found')
    assertClientAccess(user, row.award.clientId)
    const paidDate = data.paid ? (data.paidDate ?? new Date().toISOString().slice(0, 10)) : null
    await getDb()
      .update(awardInstalments)
      .set({ paidDate })
      .where(eq(awardInstalments.id, data.id))

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
