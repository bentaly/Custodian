import type { users } from '../../../drizzle/schema'

type Role = (typeof users.$inferSelect)['role']

/**
 * Who may have the new-awards email at all: admins and finance.
 *
 * Finance was excluded when this shipped (2026-09-17) on the reasoning that the Monday
 * payments digest already tells them. That was wrong, and the argument was backwards:
 * the digest fires when an INSTALMENT falls due, which can be months after the grant is
 * set up. Finance needs the lead time to plan cash against a new commitment, and a new
 * award with unverified bank details is finance's chase, surfaced on their own screen.
 * Added 2026-09-20.
 *
 * Trustees are the audience this still arguably wants: they voted, and then heard
 * nothing, and "the grants you approved are now set up" is what closes that loop. That
 * is a product decision not yet taken, and widening means changing this function alone.
 *
 * Superadmins have no `client_id`, so there is no foundation whose awards these are.
 */
export function awardNotificationsAvailable(role: Role): boolean {
  return role === 'admin' || role === 'finance'
}

/**
 * Whether an eligible person gets it when they have never touched the setting. On, for
 * both roles, same reasoning as the digests: a notification defaulted off is one nobody
 * discovers. Unlike the payments digest there is no admin/finance split here, because a
 * grant being set up is news to both of them rather than a task belonging to one.
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
