import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { programmes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateProgrammeSchema, UpdateProgrammeSchema } from '../../lib/validators/programme'

export const listProgrammes = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ foundationId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return db.query.programmes.findMany({
      where: data.foundationId
        ? (p, { eq }) => eq(p.foundationId, data.foundationId!)
        : undefined,
      with: { rounds: true },
      orderBy: (p, { asc }) => [asc(p.name)],
    })
  })

export const getProgramme = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const programme = await db.query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: { rounds: true, formFields: { orderBy: (f, { asc }) => [asc(f.displayOrder)] } },
    })
    if (!programme) throw new Error('Not found')
    return programme
  })

export const createProgramme = createServerFn({ method: 'POST' })
  .inputValidator(CreateProgrammeSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin')
    const [programme] = await db.insert(programmes).values(data).returning()
    return programme!
  })

export const updateProgramme = createServerFn({ method: 'POST' })
  .inputValidator(UpdateProgrammeSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { id, ...rest } = data
    const updates: Partial<typeof rest> & { closedAt?: Date } = { ...rest }
    if (rest.status === 'closed') updates.closedAt = new Date()
    const [programme] = await db
      .update(programmes)
      .set(updates)
      .where(eq(programmes.id, id))
      .returning()
    return programme!
  })
