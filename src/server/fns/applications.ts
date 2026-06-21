import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, count, inArray, sql, ne, ilike, gte, lt, isNotNull } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, roundProgrammes, programmes, applicationVotes, users } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import {
  ApplicationFiltersSchema,
  CreateApplicationSchema,
  GenerateAwardSchema,
  UpdateApplicationStatusSchema,
} from '../../lib/validators/application'
import { runDueDiligence } from '../dueDiligence/run'
import { runCustodianScore } from '../custodianScore/run'

export const listApplications = createServerFn({ method: 'GET' })
  .inputValidator(ApplicationFiltersSchema)
  .handler(async ({ data }) => {
    await requireAuthUser()
    const { page, pageSize, ...filters } = data

    let roundProgrammeIds: string[] | undefined
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
      roundProgrammeIds = rows.map((r) => r.id)
      if (roundProgrammeIds.length === 0) {
        return { items: [], total: 0, page, pageSize, statusCounts: {}, allCount: 0 }
      }
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
    await requireAuthUser()
    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: {
        roundProgramme: { with: { programme: { with: { client: true } }, round: true } },
      },
    })
    if (!application) throw new Error('Not found')

    const committedRows = await getDb()
      .select({
        committed: sql<string | null>`SUM(COALESCE(${applications.amountAwarded}, ${applications.amountRequested}))`,
      })
      .from(applications)
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
    const { amountRequested, ...rest } = data
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
    await requireRole('superadmin', 'admin', 'manager')

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
    await requireRole('superadmin', 'admin', 'manager')

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
      geography: application.geography,
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

// Awards screen: shortlisted applications awaiting setup ("pending") and those
// already awarded ("active"), optionally scoped to a round.
export const listAwards = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roundId: z.uuid().optional() }))
  .handler(async ({ data }) => {
    await requireAuthUser()

    let roundProgrammeIds: string[] | undefined
    if (data.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, data.roundId))
      roundProgrammeIds = rows.map((r) => r.id)
      if (roundProgrammeIds.length === 0) return { pending: [], active: [] }
    }

    const rows = await getDb().query.applications.findMany({
      where: (a, { and, inArray: inArr }) =>
        and(
          inArr(a.status, ['shortlisted', 'awarded']),
          roundProgrammeIds ? inArr(a.roundProgrammeId, roundProgrammeIds) : undefined,
        ),
      with: { roundProgramme: { with: { programme: true, round: true } } },
      orderBy: (a, { desc, asc }) => [desc(a.custodianScore), asc(a.organisationName)],
    })

    const active = rows.filter((a) => a.status === 'awarded')
    const shortlisted = rows.filter((a) => a.status === 'shortlisted')

    // A shortlisted application is only ready for award setup ("pending") once a
    // majority (> 50%) of its client's trustees have voted yes.
    let pending = [] as typeof shortlisted
    if (shortlisted.length > 0) {
      const appIds = shortlisted.map((a) => a.id)
      const clientIds = [...new Set(shortlisted.map((a) => a.roundProgramme.programme.clientId))]

      const [yesRows, trusteeRows] = await Promise.all([
        getDb()
          .select({ applicationId: applicationVotes.applicationId, yes: count() })
          .from(applicationVotes)
          .where(and(inArray(applicationVotes.applicationId, appIds), eq(applicationVotes.vote, 'yes')))
          .groupBy(applicationVotes.applicationId),
        getDb()
          .select({ clientId: users.clientId, trustees: count() })
          .from(users)
          .where(and(eq(users.role, 'trustee'), inArray(users.clientId, clientIds)))
          .groupBy(users.clientId),
      ])

      const yesByApp = new Map(yesRows.map((r) => [r.applicationId, r.yes]))
      const trusteesByClient = new Map(trusteeRows.map((r) => [r.clientId, r.trustees]))

      pending = shortlisted.filter((a) => {
        const yes = yesByApp.get(a.id) ?? 0
        const trustees = trusteesByClient.get(a.roundProgramme.programme.clientId) ?? 0
        return trustees > 0 && yes * 2 > trustees
      })
    }

    return { pending, active }
  })

export const generateAward = createServerFn({ method: 'POST' })
  .inputValidator(GenerateAwardSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')

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

    const schedule = data.schedule.map((s) => ({
      instalment: s.instalment,
      amount: s.amount.toString(),
      date: s.date,
    }))

    const [application] = await getDb()
      .update(applications)
      .set({
        status: 'awarded',
        amountAwarded: data.amountAwarded.toString(),
        paymentSchedule: schedule,
        reportingSchedule: data.reportingDates,
        decisionAt: new Date(),
      })
      .where(eq(applications.id, data.id))
      .returning()
    if (!application) throw new Error('Not found')
    return application
  })

export const getRoundBudgetSummary = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roundId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()

    const rps = await getDb().query.roundProgrammes.findMany({
      where: (rp, { eq }) => eq(rp.roundId, data.roundId),
      with: { programme: true },
      orderBy: (rp, { asc }) => [asc(rp.createdAt)],
    })
    if (rps.length === 0) return []

    const rpIds = rps.map((rp) => rp.id)

    const committedRows = await getDb()
      .select({
        roundProgrammeId: applications.roundProgrammeId,
        committed: sql<string>`COALESCE(SUM(COALESCE(${applications.amountAwarded}, ${applications.amountRequested})), '0')`,
        shortlistedCount: count(),
      })
      .from(applications)
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
    await requireRole('superadmin', 'admin', 'manager')
    const { id, status, amountAwarded } = data

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
            current: sql<string | null>`SUM(COALESCE(${applications.amountAwarded}, ${applications.amountRequested}))`,
          })
          .from(applications)
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
        ...(amountAwarded !== undefined && { amountAwarded: amountAwarded.toString() }),
        ...(isDecision && { decisionAt: new Date() }),
      })
      .where(eq(applications.id, id))
      .returning()
    return application!
  })
