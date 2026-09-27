// Server functions for editing an application. The rules are in
// `lib/applicationEdit.ts` and the writes in `server/applications/edit.ts`; these
// only check who is asking and scope to their foundation.
//
// Admin-only, like every other change to an application: a trustee reads, comments
// and votes, and finance keeps the payment schedule.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { assertApplicationAccess } from '../scope'
import { notFoundError } from '../../lib/errors'
import { EDITABLE_FIELDS, strictReading } from '../../lib/applicationEdit'
import { BudgetLineSchema } from '../../lib/validators/application'
import { toStringValue } from '../../lib/fieldMapping'
import { orderedKeys } from '../fieldMapping/assemble'
import {
  editApplication,
  othersMissing,
  rescoreApplication,
  setApplicationThemes,
  setBudgetLines,
} from '../applications/edit'

const FieldEnum = z.enum(EDITABLE_FIELDS)

export const editApplicationFields = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      changes: z
        .array(
          z.object({
            field: FieldEnum,
            value: z.string().max(20_000).nullable(),
            sourceKey: z.string().max(2000).optional(),
          }),
        )
        .min(1)
        .max(EDITABLE_FIELDS.length),
      remember: z.boolean().optional(),
      applyToOthers: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)
    return editApplication({
      applicationId: data.id,
      changes: data.changes,
      actor: { id: user.id },
      remember: data.remember,
      applyToOthers: data.applyToOthers,
    })
  })

export const setBudget = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), lines: z.array(BudgetLineSchema).max(100) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)
    return setBudgetLines({ applicationId: data.id, lines: data.lines, actor: { id: user.id } })
  })

export const setThemes = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), themes: z.array(z.string().max(200)).max(50) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)
    return setApplicationThemes({
      applicationId: data.id,
      themes: data.themes,
      actor: { id: user.id },
    })
  })

export const rescore = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)
    await rescoreApplication(data.id, { id: user.id })
    return { ok: true }
  })

/**
 * The applicant's answers a field could be read from: every answer in the submission
 * that is not already read as some field, in the order they gave them, each with the
 * reading we would take from it if it is certain enough to take without a person.
 * Empty (and `hasSubmission: false`) for an application that did not arrive through a
 * form, where typing is the only way to fill a field.
 */
export const answerCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid(), field: FieldEnum }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)
    const ingest = await getDb().query.applicationIngests.findFirst({
      where: eq(applicationIngests.applicationId, data.id),
      columns: { rawPayload: true, fieldOrder: true, resolved: true },
    })
    if (!ingest) return { hasSubmission: false, answers: [] }
    const used = new Set(Object.keys(ingest.resolved ?? {}))
    const answers = orderedKeys(ingest.rawPayload, ingest.fieldOrder)
      .filter((k) => !used.has(k))
      .map((label) => ({
        label,
        value: toStringValue(ingest.rawPayload[label]),
        reading: strictReading(data.field, ingest.rawPayload[label]),
      }))
      .filter((a) => a.value !== '')
    return { hasSubmission: true, answers }
  })

/** How many other applications answered this question and are missing this field. */
export const countOthersMissing = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid(), field: FieldEnum, sourceKey: z.string().max(2000) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertApplicationAccess(user, data.id)
    const ingest = await getDb().query.applicationIngests.findFirst({
      where: eq(applicationIngests.applicationId, data.id),
      columns: { clientId: true },
    })
    if (!ingest) throw notFoundError()
    return othersMissing({
      clientId: ingest.clientId,
      excludeApplicationId: data.id,
      field: data.field,
      sourceKey: data.sourceKey,
    })
  })
