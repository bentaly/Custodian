import type { users } from '../../../drizzle/schema'

type Role = (typeof users.$inferSelect)['role']

/**
 * Whether a user gets the digest when they have never touched the setting.
 *
 * On for `finance`, off for everyone else. This is the product doing the job the
 * finance officer's employer bought it for — the same category as an award letter, not
 * a newsletter — and a digest defaulted off is a digest nobody discovers. Admins are
 * deliberately excluded: they can turn it on, but an admin's week is applications and
 * decisions, and mail they did not ask for teaches them to ignore mail from us.
 *
 * Superadmins never get it at all: they have no `client_id`, so there is no foundation
 * whose payments the digest would be about.
 */
export function digestDefaultOn(role: Role): boolean {
  return role === 'finance'
}

/**
 * The setting, resolved. NULL in the column means "has never chosen" and follows the
 * role default; a stored `true`/`false` is a decision the user made and always wins,
 * including a `false` that merely agrees with the default of the day (their role can
 * change, their answer should not be re-asked).
 */
export function wantsDigest(user: { role: Role; weeklyFinanceDigest: boolean | null }): boolean {
  return user.weeklyFinanceDigest ?? digestDefaultOn(user.role)
}
