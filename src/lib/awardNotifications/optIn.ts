import type { users } from '../../../drizzle/schema'

type Role = (typeof users.$inferSelect)['role']

/**
 * Who may have the new-awards email at all. Admins, and nobody else for now.
 *
 * Trustees are the audience this arguably wants: they voted, and then heard nothing,
 * and "the grants you approved are now set up" is what closes that loop. That is a
 * product decision rather than a technical one and has not been taken — so this is
 * admins only, and widening it later means changing this function and nothing else.
 *
 * Finance is deliberately NOT here even though a new award creates work for them: the
 * Monday payments digest already tells them, on the day the first instalment falls due,
 * which is when they can actually act on it. Two emails about the same grant a fortnight
 * apart is how a digest gets filtered.
 *
 * Superadmins have no `client_id`, so there is no foundation whose awards these are.
 */
export function awardNotificationsAvailable(role: Role): boolean {
  return role === 'admin'
}

/**
 * Whether an admin gets it when they have never touched the setting. On, same reasoning
 * as the two digests: a notification defaulted off is one nobody discovers.
 */
export function awardNotificationsDefaultOn(role: Role): boolean {
  return awardNotificationsAvailable(role)
}

/**
 * The setting, resolved. NULL means "has never chosen" and follows the role default; a
 * stored boolean is a decision and wins.
 *
 * Availability is re-checked here as well as at the call site, so a stored `true` left
 * behind by a demotion cannot keep sending. The column is not cleared on a role change
 * on purpose: promote them back and their own answer is still there.
 */
export function wantsAwardNotifications(user: {
  role: Role
  awardNotifications: boolean | null
}): boolean {
  if (!awardNotificationsAvailable(user.role)) return false
  return user.awardNotifications ?? awardNotificationsDefaultOn(user.role)
}
