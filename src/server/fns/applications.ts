import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, count, inArray, sql, ne, ilike, gte, lt, isNotNull } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applications,
  roundProgrammes,
  programmes,
  applicationVotes,
  users,
  grants,
  grantPayments,
  grantReports,
} from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
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

    const [items, totals, statusRows] = await Promise.all([
      getDb().query.applications.findMany({
        where,
        with: { roundProgramme: { with: { programme: { with: { client: true } } } } },
        orderBy: (a, { desc }) => [desc(a.submittedAt)],
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

    // Committed = awarded grants at their grant amount + shortlisted at requested.
    const committedRows = await getDb()
      .select({
        committed: sql<string | null>`SUM(COALESCE(${grants.amountAwarded}, ${applications.amountRequested}))`,
      })
      .from(applications)
      .leftJoin(grants, eq(grants.applicationId, applications.id))
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
    const { amountRequested, ...rest } = data

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

    // Promote the award to a first-class grant: the money/schedule live on `grants` /
    // `grant_payments` and the reporting milestones on `grant_reports`. The application
    // stays the request record and only flips status.
    const grantId = crypto.randomUUID()
    await getDb().insert(grants).values({
      id: grantId,
      applicationId: data.id,
      clientId,
      amountAwarded: data.amountAwarded.toString(),
      status: 'active',
      decisionAt,
    })
    await getDb()
      .insert(grantPayments)
      .values(
        data.schedule.map((s) => ({
          grantId,
          instalmentNo: s.instalment,
          amount: s.amount.toString(),
          dueDate: s.date,
        })),
      )
    if (data.reportingDates.length > 0) {
      await getDb()
        .insert(grantReports)
        .values(
          data.reportingDates.map((r) => ({
            grantId,
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

    const committedRows = await getDb()
      .select({
        roundProgrammeId: applications.roundProgrammeId,
        committed: sql<string>`COALESCE(SUM(COALESCE(${grants.amountAwarded}, ${applications.amountRequested})), '0')`,
        shortlistedCount: count(),
      })
      .from(applications)
      .leftJoin(grants, eq(grants.applicationId, applications.id))
      .where(and(
        inArray(applications.roundProgrammeId, rpIds),
        inArray(applications.status, ['shortlisted', 'awarded']),
      ))
      .groupBy(applications.roundProgrammeId)

    const byRpId = new Map(committedRows.map((r) => [r.roundProgrammeId, r]))

    return rps.map((rp) => {
      const row = byRpId.get(rp.id)
      return {
        roundProgrammeId: rp.id,
        programmeName: rp.programme.name,
        budget: rp.budget ? parseFloat(rp.budget) : null,
        committed: row ? parseFloat(row.committed) : 0,
        shortlistedCount: row?.shortlistedCount ?? 0,
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
            current: sql<string | null>`SUM(COALESCE(${grants.amountAwarded}, ${applications.amountRequested}))`,
          })
          .from(applications)
          .leftJoin(grants, eq(grants.applicationId, applications.id))
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
    return application!
  })

// Record screen: the register of every grant ever awarded for the caller's client —
// across all rounds and programmes, regardless of payment progress. Reads `grants`
// (via the awarded application that produced each), with instalments rolled up for
// paid-to-date. Filters mirror the Applications list (round / programme / tag / search).
export const listGrantRecord = createServerFn({ method: 'GET' })
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
        grant: { with: { payments: true } },
      },
      orderBy: (a, { desc }) => [desc(a.decisionAt)],
    })

    // An awarded application without a grant row hasn't been backfilled yet; skip it
    // rather than guess an amount.
    const items = apps
      .filter((a) => a.grant)
      .map((a) => {
        const grant = a.grant!
        const amountAwarded = parseFloat(grant.amountAwarded)
        const paidToDate = grant.payments
          .filter((p) => p.paidDate)
          .reduce((s, p) => s + parseFloat(p.amount), 0)
        return {
          grantId: grant.id,
          applicationId: a.id,
          organisationName: a.organisationName,
          programmeName: a.roundProgramme?.programme?.name ?? null,
          roundName: a.roundProgramme?.round?.name ?? null,
          tags: (a.roundProgramme?.programme?.tags as string[] | null) ?? [],
          durationYears: a.roundProgramme?.grantDurationYears ?? null,
          deliveryArea: a.deliveryRegion ?? a.deliveryArea ?? null,
          status: grant.status,
          decisionAt: grant.decisionAt,
          amountAwarded,
          instalmentCount: grant.payments.length,
          paidCount: grant.payments.filter((p) => p.paidDate).length,
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
