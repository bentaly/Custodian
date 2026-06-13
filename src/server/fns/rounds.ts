import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { rounds } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateRoundSchema, UpdateRoundSchema } from '../../lib/validators/round'

export const listRounds = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ clientId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return getDb().query.rounds.findMany({
      where: (r, { eq }) => eq(r.clientId, data.clientId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    })
  })

export const listMyRounds = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []
  return getDb().query.rounds.findMany({
    where: (r, { eq }) => eq(r.clientId, user.clientId!),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
    with: {
      roundProgrammes: {
        with: { programme: true },
        orderBy: (rp, { asc }) => [asc(rp.createdAt)],
      },
    },
  })
})

export const getRound = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const round = await getDb().query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, data.id),
      with: {
        client: true,
        roundProgrammes: {
          with: { programme: true },
          orderBy: (rp, { asc }) => [asc(rp.createdAt)],
        },
      },
    })
    if (!round) throw new Error('Not found')
    return round
  })

export const createRound = createServerFn({ method: 'POST' })
  .inputValidator(CreateRoundSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { budget, openedAt, closedAt, ...rest } = data
    const [round] = await getDb()
      .insert(rounds)
      .values({
        ...rest,
        budget: budget?.toString(),
        openedAt: openedAt ? new Date(openedAt) : undefined,
        closedAt: closedAt ? new Date(closedAt) : undefined,
      })
      .returning()
    return round!
  })

export const updateRound = createServerFn({ method: 'POST' })
  .inputValidator(UpdateRoundSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { id, budget, openedAt, closedAt, ...rest } = data
    const [round] = await getDb()
      .update(rounds)
      .set({
        ...rest,
        ...(budget !== undefined ? { budget: budget.toString() } : {}),
        ...(openedAt !== undefined ? { openedAt: openedAt ? new Date(openedAt) : null } : {}),
        ...(closedAt !== undefined ? { closedAt: closedAt ? new Date(closedAt) : null } : {}),
      })
      .where(eq(rounds.id, id))
      .returning()
    return round!
  })

