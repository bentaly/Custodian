import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { programmes, roundProgrammes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateProgrammeSchema, UpdateProgrammeSchema } from '../../lib/validators/programme'

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
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const programme = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: {
        roundProgrammes: { with: { round: true } },
      },
    })
    if (!programme) throw new Error('Not found')
    return programme
  })

export const createProgramme = createServerFn({ method: 'POST' })
  .inputValidator(CreateProgrammeSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin')
    const [programme] = await getDb().insert(programmes).values(data).returning()
    return programme!
  })

export const updateProgramme = createServerFn({ method: 'POST' })
  .inputValidator(UpdateProgrammeSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { id, ...rest } = data
    const [programme] = await getDb()
      .update(programmes)
      .set(rest)
      .where(eq(programmes.id, id))
      .returning()
    return programme!
  })

export const addProgrammeToRound = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ roundId: z.string().uuid(), programmeId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const [link] = await getDb().insert(roundProgrammes).values(data).returning()
    return link!
  })

export const removeProgrammeFromRound = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ roundId: z.string().uuid(), programmeId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
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
