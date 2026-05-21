import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { formFields } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateFormFieldSchema, UpdateFormFieldSchema } from '../../lib/validators/form-field'

export const listFormFields = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ programmeId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return db.query.formFields.findMany({
      where: (f, { eq }) => eq(f.programmeId, data.programmeId),
      orderBy: (f, { asc }) => [asc(f.displayOrder)],
    })
  })

export const createFormField = createServerFn({ method: 'POST' })
  .inputValidator(CreateFormFieldSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const [field] = await db.insert(formFields).values(data).returning()
    return field!
  })

export const updateFormField = createServerFn({ method: 'POST' })
  .inputValidator(UpdateFormFieldSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    const { id, ...rest } = data
    const [field] = await db
      .update(formFields)
      .set(rest)
      .where(eq(formFields.id, id))
      .returning()
    return field!
  })

export const deleteFormField = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireRole('superadmin', 'admin', 'manager')
    await db.delete(formFields).where(eq(formFields.id, data.id))
  })
