import type { users } from '../../../drizzle/schema'

type Role = (typeof users.$inferSelect)['role']

/**
 * Who may have the reports digest at all.
 *
 * Admins, and nobody else. This is a narrower rule than the payments digest, which any
 * tenant user can switch on for themselves — and the difference is deliberate. The
 * payments email is information: a trustee who wants to know what is going out this
 * week is welcome to it. This email is a WORK QUEUE. Every line on it is a grantee
 * somebody has to write to, and the person who writes to grantees is the admin. A
 * trustee offered the switch would be signing up for work that is not theirs, and
 * would then either do it (badly, from an email) or learn to ignore us.
 *
 * Finance is excluded for the same reason and one more: a finance officer already has a
 * Monday email from us. Two arriving together, one of them about work they do not do,
 * is how both get filtered.
 *
 * Superadmins have no `client_id`, so there is no foundation whose reports this would
 * be about.
 */
export function reportsDigestAvailable(role: Role): boolean {
  return role === 'admin'
}

/**
 * Whether an admin gets it when they have never touched the setting.
 *
 * On. Same reasoning as `digestDefaultOn`: a digest defaulted off is a digest nobody
 * discovers, and an overdue report that nobody chases is the failure this is for. It is
 * only ever on for a role that is already doing this job by hand.
 */
export function reportsDigestDefaultOn(role: Role): boolean {
  return reportsDigestAvailable(role)
}

/**
 * The setting, resolved. NULL means "has never chosen" and follows the role default; a
 * stored boolean is a decision and always wins.
 *
 * The availability check is applied here as well as at the call site, so a stored `true`
 * left behind by a demotion (an admin who became a trustee) cannot keep sending. The
 * column is not cleared on a role change on purpose: promote them back and their own
 * answer is still there.
 */
export function wantsReportsDigest(user: {
  role: Role
  weeklyReportsDigest: boolean | null
}): boolean {
  if (!reportsDigestAvailable(user.role)) return false
  return user.weeklyReportsDigest ?? reportsDigestDefaultOn(user.role)
}
