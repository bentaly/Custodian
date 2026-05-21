import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { foundations } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateFoundationSchema, UpdateFoundationSchema } from '../../lib/validators/foundation'

export const listFoundations = createServerFn({ method: 'GET' }).handler(async () => {
  await requireRole('superadmin')
  return db.query.foundations.findMany({
    orderBy: (f, { asc }) => [asc(f.name)],
  })
})

export const getFoundation = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const foundation = await db.query.foundations.findFirst({
      where: (f, { eq }) => eq(f.id, data.id),
      with: { programmes: true },
    })
    if (!foundation) throw new Error('Not found')
    return foundation
  })

export const createFoundation = createServerFn({ method: 'POST' })
  .inputValidator(CreateFoundationSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin')
    const [foundation] = await db.insert(foundations).values(data).returning()
    return foundation!
  })

export const updateFoundation = createServerFn({ method: 'POST' })
  .inputValidator(UpdateFoundationSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin')
    const { id, ...rest } = data
    const [foundation] = await db
      .update(foundations)
      .set(rest)
      .where(eq(foundations.id, id))
      .returning()
    return foundation!
  })
