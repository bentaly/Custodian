// ─── Team membership rules ───────────────────────────────────────────────────
//
// Pure half of removing a member and changing a role. The IO lives in
// `src/server/members.ts` (the guarded writes) and `src/server/fns/team.ts`.
//
// **Removing someone is an archive, not a delete.** Their votes, comments and audit
// rows are the foundation's record of how a decision was made, and both
// `application_votes` and `application_comments` CASCADE on a deleted user: a hard
// delete would quietly turn a 3-2 award into 2-2 with nothing anywhere to say why. So
// the row stays, keeping its name and role, and loses everything that lets anybody
// sign in as it: its sessions, its linked logins, its photo, and its email address,
// which is tombstoned so the person can be invited again (`users.email` is unique).
//
// **An archived trustee's vote stops counting on anything still undecided.** That is
// the rule `listShortlist` already applied to a trustee whose role changed: the
// majority is of the CURRENT board. A grant already awarded is untouched, because the
// award row exists and nothing re-derives it.

import { INVITABLE_ROLES } from './roles'

export type MemberRole = 'superadmin' | 'admin' | 'trustee' | 'finance'

export interface TeamPerson {
  id: string
  role: MemberRole
  clientId: string | null
  archivedAt: Date | null
}

/**
 * The address an archived member's row is left holding.
 *
 * `.invalid` is reserved (RFC 2606), so nothing can ever be delivered to it or sign in
 * as it, and the user id makes it unique without needing to know anything else.
 */
export const ARCHIVED_EMAIL_DOMAIN = 'archived.custodian.invalid'

export function archivedEmail(userId: string): string {
  return `${userId}@${ARCHIVED_EMAIL_DOMAIN}`
}

const NOT_FOUND = 'We could not find that team member.'
const PLATFORM_ACCOUNT = 'Platform accounts cannot be changed here.'

export const LAST_ADMIN_MESSAGE =
  'Every foundation needs at least one admin. Make someone else an admin first.'

export const LAST_ADMIN_SELF_MESSAGE =
  'You are the only admin, so your account cannot be removed. Make someone else an admin first.'

const isAdmin = (role: MemberRole) => role === 'admin' || role === 'superadmin'

/**
 * Why `actor` may not remove `target`, in words for the screen, or null if they may.
 *
 * `via` separates the two doors. `team` is an admin removing a colleague from Settings
 * → Team; `self` is anybody removing their own account from Profile, which also demands
 * an emailed code. Your own row is refused on the Team door so that removing yourself
 * always goes through the code.
 *
 * `activeAdmins` is the tenant's count of unarchived admins, INCLUDING the target.
 * This is the check that produces a message; the write in `archiveMember` re-makes it
 * in SQL, because two admins removing each other at the same moment would both pass
 * here.
 */
export function removalRefusal(input: {
  actor: TeamPerson
  target: TeamPerson | null
  activeAdmins: number
  via: 'team' | 'self'
}): string | null {
  const { actor, target, activeAdmins, via } = input
  if (!target) return NOT_FOUND
  if (target.role === 'superadmin') return PLATFORM_ACCOUNT

  if (via === 'team') {
    if (!isAdmin(actor.role)) return 'Only an admin can remove someone from the team.'
    if (target.id === actor.id) return 'To remove your own account, go to your Profile.'
  } else if (target.id !== actor.id) {
    return 'You can only remove your own account here.'
  }

  if (!actor.clientId || target.clientId !== actor.clientId) return NOT_FOUND
  if (target.archivedAt) return 'They have already been removed from the team.'

  if (target.role === 'admin' && activeAdmins <= 1) {
    return via === 'self' ? LAST_ADMIN_SELF_MESSAGE : LAST_ADMIN_MESSAGE
  }
  return null
}

/**
 * Why `actor` may not move `target` to `nextRole`, or null if they may.
 *
 * An admin may change their own role, as long as somebody else is left holding admin:
 * stepping down is a normal thing to do, and the last-admin rule is the only thing that
 * makes it dangerous.
 */
export function roleChangeRefusal(input: {
  actor: TeamPerson
  target: TeamPerson | null
  nextRole: string
  activeAdmins: number
}): string | null {
  const { actor, target, nextRole, activeAdmins } = input
  if (!isAdmin(actor.role)) return "Only an admin can change someone's role."
  if (!target) return NOT_FOUND
  if (target.role === 'superadmin') return PLATFORM_ACCOUNT
  if (!actor.clientId || target.clientId !== actor.clientId) return NOT_FOUND
  if (target.archivedAt) return 'They have been removed from the team.'
  if (!INVITABLE_ROLES.some((r) => r.value === nextRole)) {
    return 'That is not a role a team member can have.'
  }
  if (nextRole === target.role) return 'They already have that role.'
  if (target.role === 'admin' && activeAdmins <= 1) return LAST_ADMIN_MESSAGE
  return null
}

/**
 * A signed-in session's device, as a person would name it: "Chrome on macOS".
 *
 * Deliberately coarse. It exists so somebody can recognise a session that is not
 * theirs, and a version number helps nobody do that. Order matters: iPads report
 * "Mac OS X", Chrome reports "Safari", and Edge and Opera both report "Chrome".
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const ua = userAgent

  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null

  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null

  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'Unknown device'
}
