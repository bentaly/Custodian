import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { programmes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateProgrammeSchema, UpdateProgrammeSchema } from '../../lib/validators/programme'

export const listProgrammes = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roundId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return getDb().query.programmes.findMany({
      where: data.roundId
        ? (p, { eq }) => eq(p.roundId, data.roundId!)
        : undefined,
      with: { applications: true },
      orderBy: (p, { asc }) => [asc(p.name)],
    })
  })

export const getProgramme = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const programme = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: { applications: true, formFields: { orderBy: (f, { asc }) => [asc(f.displayOrder)] } },
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
    const updates: Partial<typeof rest> & { closedAt?: Date } = { ...rest }
    if (rest.status === 'closed') updates.closedAt = new Date()
    const [programme] = await getDb()
      .update(programmes)
      .set(updates)
      .where(eq(programmes.id, id))
      .returning()
    return programme!
  })
