import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { rounds } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateRoundSchema, UpdateRoundStatusSchema } from '../../lib/validators/round'

export const listRounds = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ programmeId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return db.query.rounds.findMany({
      where: (r, { eq }) => eq(r.programmeId, data.programmeId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    })
  })

export const getRound = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const round = await db.query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, data.id),
      with: { programme: true },
    })
    if (!round) throw new Error('Not found')
    return round
  })

export const createRound = createServerFn({ method: 'POST' })
  .inputValidator(CreateRoundSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { budget, ...rest } = data
    const [round] = await db
      .insert(rounds)
      .values({ ...rest, budget: budget?.toString() })
      .returning()
    return round!
  })

export const updateRoundStatus = createServerFn({ method: 'POST' })
  .inputValidator(UpdateRoundStatusSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { id, status } = data

    const timestamps: { openedAt?: Date; closedAt?: Date } = {}
    if (status === 'open') timestamps.openedAt = new Date()
    if (status === 'closed') timestamps.closedAt = new Date()

    const [round] = await db
      .update(rounds)
      .set({ status, ...timestamps })
      .where(eq(rounds.id, id))
      .returning()
    return round!
  })
