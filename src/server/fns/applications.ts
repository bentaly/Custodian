import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, count, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, applicationResponses, roundProgrammes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import {
  ApplicationFiltersSchema,
  CreateApplicationSchema,
  UpdateApplicationStatusSchema,
} from '../../lib/validators/application'

export const listApplications = createServerFn({ method: 'GET' })
  .inputValidator(ApplicationFiltersSchema)
  .handler(async ({ data }) => {
    await requireAuthUser()
    const { page, pageSize, ...filters } = data

    let programmeIds: string[] | undefined
    if (filters.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.programmeId })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, filters.roundId))
      programmeIds = rows.map((r) => r.id)
      if (programmeIds.length === 0) {
        return { items: [], total: 0, page, pageSize }
      }
    }

    const where = and(
      filters.status ? eq(applications.status, filters.status) : undefined,
      filters.programmeId ? eq(applications.programmeId, filters.programmeId) : undefined,
      programmeIds ? inArray(applications.programmeId, programmeIds) : undefined,
    )

    const [items, totals] = await Promise.all([
      getDb().query.applications.findMany({
        where,
        with: { programme: { with: { client: true } } },
        orderBy: (a, { desc }) => [desc(a.submittedAt)],
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      getDb().select({ total: count() }).from(applications).where(where),
    ]).catch((err) => { console.error('listApplications DB error:', err?.cause ?? err); throw err })

    return { items, total: totals[0]?.total ?? 0, page, pageSize }
  })

export const getApplication = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: {
        programme: { with: { client: true } },
        responses: { with: { field: true } },
      },
    })
    if (!application) throw new Error('Not found')
    return application
  })

export const createApplication = createServerFn({ method: 'POST' })
  .inputValidator(CreateApplicationSchema)
  .handler(async ({ data }) => {
    const { responses, amountRequested, ...rest } = data
    const id = crypto.randomUUID()

    await getDb().insert(applications).values({
      id,
      ...rest,
      amountRequested: amountRequested.toString(),
    })

    if (Object.keys(responses).length > 0) {
      await getDb().insert(applicationResponses).values(
        Object.entries(responses).map(([fieldId, value]) => ({
          applicationId: id,
          fieldId,
          value,
        })),
      )
    }

    const application = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, id),
      with: { responses: true },
    })
    return application!
  })

export const updateApplicationStatus = createServerFn({ method: 'POST' })
  .inputValidator(UpdateApplicationStatusSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { id, status, amountAwarded } = data

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
