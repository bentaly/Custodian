import type { users } from '../../../drizzle/schema'

type Role = (typeof users.$inferSelect)['role']

/**
 * Who may have the payments digest at all: finance and admins.
 *
 * This used to be EVERYONE with a client, defaulted on for finance, and trustees could
 * switch it on for themselves. Narrowed 2026-09-20: a trustee reads applications and
 * votes, and the week's payment run is not theirs to make. Offering it was a small
 * invitation to confuse who is responsible for money going out, which on a grants
 * platform is the one thing worth being pedantic about.
 *
 * Admins stay eligible because at a small foundation the admin IS the person who pays.
 *
 * Superadmins never get it: they have no `client_id`, so there is no foundation whose
 * payments the digest would be about.
 */
export function financeDigestAvailable(role: Role): boolean {
  return role === 'finance' || role === 'admin'
}

/**
 * Whether a user gets the digest when they have never touched the setting.
 *
 * On for `finance`, off for everyone else INCLUDING admins, who may switch it on. That
 * split is deliberate and survived the narrowing above: an admin's week is applications
 * and decisions, and mail they did not ask for teaches them to ignore mail from us. The
 * finance officer's employer bought the product for this, so for them it is the same
 * category as an award letter rather than a newsletter, and a digest defaulted off is a
 * digest nobody discovers.
 */
export function digestDefaultOn(role: Role): boolean {
  return role === 'finance'
}

/**
 * The setting, resolved. NULL in the column means "has never chosen" and follows the
 * role default; a stored `true`/`false` is a decision the user made and always wins,
 * including a `false` that merely agrees with the default of the day (their role can
 * change, their answer should not be re-asked).
 *
 * Availability is checked FIRST, and that check is what makes the narrowing real: a
 * trustee who opted in while it was offered to them still carries a stored `true`, and
 * without this they would go on receiving it for good. The column is deliberately not
 * cleared on a role change, so re-role them to finance and their own answer is still
 * there. Same shape as `wantsReportsDigest` and `wantsAwardNotifications`.
 */
export function wantsDigest(user: { role: Role; weeklyFinanceDigest: boolean | null }): boolean {
  if (!financeDigestAvailable(user.role)) return false
  return user.weeklyFinanceDigest ?? digestDefaultOn(user.role)
}
