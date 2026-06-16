import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, count, inArray, sql, ne } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, roundProgrammes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import {
  ApplicationFiltersSchema,
  CreateApplicationSchema,
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
    if (filters.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, filters.roundId))
      roundProgrammeIds = rows.map((r) => r.id)
      if (roundProgrammeIds.length === 0) {
        return { items: [], total: 0, page, pageSize }
      }
    } else if (filters.programmeId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.programmeId, filters.programmeId))
      roundProgrammeIds = rows.map((r) => r.id)
      if (roundProgrammeIds.length === 0) {
        return { items: [], total: 0, page, pageSize }
      }
    }

    const where = and(
      filters.status ? eq(applications.status, filters.status) : undefined,
      roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
    )

    const [items, totals] = await Promise.all([
      getDb().query.applications.findMany({
        where,
        with: { roundProgramme: { with: { programme: { with: { client: true } } } } },
        orderBy: (a, { desc }) => [desc(a.submittedAt)],
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      getDb().select({ total: count() }).from(applications).where(where),
    ]).catch((err) => { console.error('listApplications DB error:', err?.cause ?? err); throw err })

    return { items, total: totals[0]?.total ?? 0, page, pageSize }
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
        inArray(applications.status, ['shortlisted', 'approved']),
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
        inArray(applications.status, ['shortlisted', 'approved']),
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
            inArray(applications.status, ['shortlisted', 'approved']),
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

    const decisionStatuses = ['approved', 'declined'] as const
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
