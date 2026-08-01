import { forbidden } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '../db'
import { clientProfiles } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'

export const getClientProfile = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return null
  const profile = await getDb().query.clientProfiles.findFirst({
    where: (p, { eq }) => eq(p.clientId, user.clientId!),
  })
  return profile ?? null
})

export const upsertClientProfile = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      missionStatement: z.string().optional(),
      allowAdminVoting: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    // Only set the fields the caller actually provided, so updating one setting
    // (e.g. the admin-voting toggle) never clobbers another (the mission statement).
    const fields: Partial<typeof clientProfiles.$inferInsert> = {}
    if (data.missionStatement !== undefined) fields.missionStatement = data.missionStatement
    if (data.allowAdminVoting !== undefined) fields.allowAdminVoting = data.allowAdminVoting
    const [profile] = await getDb()
      .insert(clientProfiles)
      .values({ clientId: user.clientId, ...fields })
      .onConflictDoUpdate({
        target: clientProfiles.clientId,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning()
    return profile!
  })
