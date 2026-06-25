import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { programmes, roundProgrammes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { CreateProgrammeSchema, UpdateProgrammeSchema, AddProgrammeToRoundSchema, UpdateRoundProgrammeSchema } from '../../lib/validators/programme'

export const listProgrammes = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []
  return getDb().query.programmes.findMany({
    where: (p, { eq }) => eq(p.clientId, user.clientId!),
    with: {
      roundProgrammes: { with: { round: true } },
    },
    orderBy: (p, { asc }) => [asc(p.name)],
  })
})

export const getProgramme = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const programme = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: {
        roundProgrammes: { with: { round: true } },
      },
    })
    if (!programme) throw new Error('Not found')
    assertClientAccess(user, programme.clientId)
    return programme
  })

export const createProgramme = createServerFn({ method: 'POST' })
  .inputValidator(CreateProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    assertClientAccess(user, data.clientId)
    const [programme] = await getDb().insert(programmes).values(data).returning()
    return programme!
  })

export const updateProgramme = createServerFn({ method: 'POST' })
  .inputValidator(UpdateProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const { id, ...rest } = data
    const existing = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, id),
      columns: { clientId: true },
    })
    if (!existing) throw new Error('Not found')
    assertClientAccess(user, existing.clientId)
    const [programme] = await getDb()
      .update(programmes)
      .set(rest)
      .where(eq(programmes.id, id))
      .returning()
    return programme!
  })

export const addProgrammeToRound = createServerFn({ method: 'POST' })
  .inputValidator(AddProgrammeToRoundSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const { budget, maxGrantAmount, ...rest } = data
    // Both the round and the programme must belong to the caller's client; this
    // also prevents stitching a programme from one client onto another's round.
    const [round, programme] = await Promise.all([
      getDb().query.rounds.findFirst({
        where: (r, { eq }) => eq(r.id, rest.roundId),
        columns: { clientId: true },
      }),
      getDb().query.programmes.findFirst({
        where: (p, { eq }) => eq(p.id, rest.programmeId),
        columns: { clientId: true },
      }),
    ])
    if (!round || !programme) throw new Error('Not found')
    if (round.clientId !== programme.clientId) throw new Error('Forbidden')
    assertClientAccess(user, round.clientId)
    const [link] = await getDb()
      .insert(roundProgrammes)
      .values({
        ...rest,
        budget: budget.toString(),
        maxGrantAmount: maxGrantAmount?.toString(),
      })
      .returning()
    return link!
  })

export const updateRoundProgramme = createServerFn({ method: 'POST' })
  .inputValidator(UpdateRoundProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const { id, budget, maxGrantAmount, ...rest } = data
    const existing = await getDb().query.roundProgrammes.findFirst({
      where: (rp, { eq }) => eq(rp.id, id),
      with: { programme: { columns: { clientId: true } } },
    })
    if (!existing) throw new Error('Not found')
    assertClientAccess(user, existing.programme.clientId)
    const [link] = await getDb()
      .update(roundProgrammes)
      .set({
        ...rest,
        budget: budget.toString(),
        ...(maxGrantAmount !== undefined ? { maxGrantAmount: maxGrantAmount.toString() } : { maxGrantAmount: null }),
      })
      .where(eq(roundProgrammes.id, id))
      .returning()
    return link!
  })

export const removeProgrammeFromRound = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ roundId: z.uuid(), programmeId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager')
    const existing = await getDb().query.roundProgrammes.findFirst({
      where: (rp, { eq, and: andOp }) =>
        andOp(eq(rp.roundId, data.roundId), eq(rp.programmeId, data.programmeId)),
      with: { programme: { columns: { clientId: true } } },
    })
    if (!existing) throw new Error('Not found')
    assertClientAccess(user, existing.programme.clientId)
    await getDb()
      .delete(roundProgrammes)
      .where(
        and(
          eq(roundProgrammes.roundId, data.roundId),
          eq(roundProgrammes.programmeId, data.programmeId),
        ),
      )
  })

export const listClientTags = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []

  const clientProgrammes = await getDb().query.programmes.findMany({
    where: (p, { eq }) => eq(p.clientId, user.clientId!),
  })

  const tagSet = new Set<string>()
  for (const prog of clientProgrammes) {
    for (const tag of (prog.tags ?? []) as string[]) {
      if (tag) tagSet.add(tag)
    }
  }
  return Array.from(tagSet).sort()
})
