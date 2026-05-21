import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, inArray, count } from 'drizzle-orm'
import { db } from '../db'
import { applications, applicationResponses, rounds } from '../../../drizzle/schema'
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

    // programmeId filter requires resolving round IDs
    let roundIds: string[] | undefined
    if (filters.programmeId) {
      const r = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(eq(rounds.programmeId, filters.programmeId))
      roundIds = r.map((x) => x.id)
      if (roundIds.length === 0) return { items: [], total: 0, page, pageSize }
    }

    const where = and(
      filters.status ? eq(applications.status, filters.status) : undefined,
      filters.roundId ? eq(applications.roundId, filters.roundId) : undefined,
      roundIds ? inArray(applications.roundId, roundIds) : undefined,
    )

    const [items, totals] = await Promise.all([
      db.query.applications.findMany({
        where,
        with: { round: { with: { programme: true } } },
        orderBy: (a, { desc }) => [desc(a.submittedAt)],
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      db.select({ total: count() }).from(applications).where(where),
    ])

    return { items, total: totals[0]?.total ?? 0, page, pageSize }
  })

export const getApplication = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const application = await db.query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.id),
      with: {
        round: { with: { programme: true } },
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

    await db.insert(applications).values({
      id,
      ...rest,
      amountRequested: amountRequested.toString(),
    })

    if (Object.keys(responses).length > 0) {
      await db.insert(applicationResponses).values(
        Object.entries(responses).map(([fieldId, value]) => ({
          applicationId: id,
          fieldId,
          value,
        })),
      )
    }

    const application = await db.query.applications.findFirst({
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

    const [application] = await db
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
