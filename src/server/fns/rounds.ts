import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { rounds } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { CreateRoundSchema, UpdateRoundSchema } from '../../lib/validators/round'

export const listRounds = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ clientId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    // Non-superadmins may only list their own client's rounds.
    assertClientAccess(user, data.clientId)
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
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
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
    assertClientAccess(user, round.clientId)
    return round
  })

export const createRound = createServerFn({ method: 'POST' })
  .inputValidator(CreateRoundSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    assertClientAccess(user, data.clientId)
    const { openedAt, closedAt, ...rest } = data
    const [round] = await getDb()
      .insert(rounds)
      .values({
        ...rest,
        openedAt: openedAt ? new Date(openedAt) : undefined,
        closedAt: closedAt ? new Date(closedAt) : undefined,
      })
      .returning()
    return round!
  })

export const updateRound = createServerFn({ method: 'POST' })
  .inputValidator(UpdateRoundSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const { id, openedAt, closedAt, ...rest } = data
    const existing = await getDb().query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, id),
      columns: { clientId: true },
    })
    if (!existing) throw new Error('Not found')
    assertClientAccess(user, existing.clientId)
    const [round] = await getDb()
      .update(rounds)
      .set({
        ...rest,
        ...(openedAt !== undefined ? { openedAt: openedAt ? new Date(openedAt) : null } : {}),
        ...(closedAt !== undefined ? { closedAt: closedAt ? new Date(closedAt) : null } : {}),
      })
      .where(eq(rounds.id, id))
      .returning()
    return round!
  })

export const deleteRound = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const round = await getDb().query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, data.id),
      with: {
        roundProgrammes: {
          with: { applications: { columns: { id: true }, limit: 1 } },
        },
      },
    })
    if (!round) throw new Error('Not found')
    // Scope non-superadmins to their own client.
    if (user.clientId && round.clientId !== user.clientId) throw new Error('Forbidden')
    // applications.roundProgrammeId is ON DELETE RESTRICT, so deleting a round that
    // has applications would fail at the DB; surface a clear message instead.
    const hasApplications = round.roundProgrammes.some((rp) => rp.applications.length > 0)
    if (hasApplications) {
      throw new Error('This round has applications and cannot be deleted.')
    }
    await getDb().delete(rounds).where(eq(rounds.id, data.id))
    return { ok: true }
  })

