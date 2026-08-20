import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { users } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { wantsDigest } from '../../lib/financeDigest/optIn'

export const listClientUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []

  return getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.clientId, user.clientId))
    .orderBy(users.createdAt)
})

/**
 * The signed-in user's email preferences, resolved.
 *
 * Deliberately its own query rather than a column on `getAuthUser`: that select runs on
 * every authenticated server call and this is read on one screen. The value returned is
 * the RESOLVED boolean (`wantsDigest`), not the raw nullable column — the screen shows
 * the user what will happen, and "NULL means the role default" is a storage detail.
 */
export const getMyEmailPreferences = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  const row = await getDb().query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { role: true, weeklyFinanceDigest: true },
  })
  // Superadmins have no client, so there is no foundation whose payments a digest would
  // be about — the setting is hidden rather than shown switched off for a reason nobody
  // could guess.
  return {
    weeklyFinanceDigest: row ? wantsDigest(row) : false,
    available: user.role !== 'superadmin' && !!user.clientId,
  }
})

/**
 * Turn the weekly payments digest on or off for yourself. Always writes an explicit
 * boolean, never NULL: NULL means "has never chosen" and would put the user straight
 * back on their role default, which for a finance user turning it OFF would silently
 * turn it back on.
 */
export const setWeeklyFinanceDigest = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    await getDb()
      .update(users)
      .set({ weeklyFinanceDigest: data.enabled })
      .where(eq(users.id, user.id))
    return { weeklyFinanceDigest: data.enabled }
  })
