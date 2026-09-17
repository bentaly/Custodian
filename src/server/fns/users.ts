import { createServerFn } from '@tanstack/react-start'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { users } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { wantsDigest } from '../../lib/financeDigest/optIn'
import { reportsDigestAvailable, wantsReportsDigest } from '../../lib/reportsDigest/optIn'

/** The foundation's current team. Removed members are archived rows and are left out. */
export const listClientUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []

  return getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      // Only meaningful on an admin. The Team screen's Votes column reads it through
      // `holdsAVote`, which is also what decides whether a trustee shows as voting.
      votesOnApplications: users.votesOnApplications,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.clientId, user.clientId), isNull(users.archivedAt)))
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
    columns: { role: true, weeklyFinanceDigest: true, weeklyReportsDigest: true },
  })
  // Superadmins have no client, so there is no foundation whose payments a digest would
  // be about — the setting is hidden rather than shown switched off for a reason nobody
  // could guess. The reports digest is narrower still: admins only, so a trustee is not
  // offered a switch that subscribes them to somebody else's chase list.
  const tenanted = user.role !== 'superadmin' && !!user.clientId
  return {
    weeklyFinanceDigest: row ? wantsDigest(row) : false,
    weeklyReportsDigest: row ? wantsReportsDigest(row) : false,
    available: tenanted,
    reportsAvailable: tenanted && reportsDigestAvailable(user.role),
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

/**
 * Turn the weekly reports digest on or off for yourself.
 *
 * Refused for anyone the digest is not offered to, rather than written and then ignored
 * at send time. The screen already hides the switch, but this is the boundary, and a
 * stored `true` on a trustee is a row that reads as a subscription somebody will one
 * day "fix" by making it work. Same explicit-boolean rule as the payments setting: NULL
 * means "has never chosen" and would put an admin straight back on the default.
 */
export const setWeeklyReportsDigest = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    if (!user.clientId || !reportsDigestAvailable(user.role)) {
      throw new Error('The weekly reports digest is only available to admins.')
    }
    await getDb()
      .update(users)
      .set({ weeklyReportsDigest: data.enabled })
      .where(eq(users.id, user.id))
    return { weeklyReportsDigest: data.enabled }
  })
