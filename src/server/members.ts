// ─── Team membership: the guarded writes and the shared roster filters ────────
//
// The rules, and why removal is an archive, are in `src/lib/team.ts`.

import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb } from './db'
import { accounts, sessions, userAvatars, users, verifications } from '../../drizzle/schema'
import { archivedEmail, type MemberRole } from '../lib/team'
import { removalCodeIdentifier } from '../lib/removalCode'

/**
 * The trustees whose votes count for `clientId`: role trustee, not archived.
 *
 * EVERY vote roster and majority count goes through this, numerator and denominator
 * alike. They used to be five separate `role = 'trustee' AND client_id = …` clauses, and
 * the numerators counted every yes-vote on the application regardless of who cast it, so
 * a trustee moved to finance still tipped awards in `createAwards` while `listShortlist`
 * (which did filter) showed them not counting. Role changes and removal made that
 * reachable; one definition keeps the screens and the write path agreeing.
 */
export function currentTrusteeOf(clientId: string) {
  return and(eq(users.role, 'trustee'), eq(users.clientId, clientId), isNull(users.archivedAt))
}

export function currentTrusteeOfAny(clientIds: string[]) {
  return and(
    eq(users.role, 'trustee'),
    inArray(users.clientId, clientIds),
    isNull(users.archivedAt),
  )
}

export async function activeAdminCount(clientId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.role, 'admin'), isNull(users.archivedAt)))
  return row?.n ?? 0
}

/**
 * True when some OTHER unarchived admin shares this user's client. Written as SQL inside
 * the guarded UPDATEs below, so the last-admin rule holds even when two admins act on
 * each other at the same moment: `removalRefusal` checks first to produce a message, but
 * a check-then-write in two requests cannot enforce it.
 */
function anotherAdminExists(userId: string) {
  return sql`exists (
    select 1 from ${users} as other
    where other.client_id = ${users.clientId}
      and other.role = 'admin'
      and other.archived_at is null
      and other.id <> ${userId}
  )`
}

/**
 * Archive a member: in ONE batch, so they are never half-removed.
 *
 * The UPDATE is guarded (not already archived; not the last admin), and every DELETE
 * after it is conditional on the row now BEING archived, so a refused update removes
 * nothing. Returns false when the guard refused, which the caller reports as a race.
 *
 * `email` is the address as it stood, needed to clear any sign-in or reset code
 * BetterAuth is holding for it (`<type>-otp-<email>` in `verifications`).
 */
export async function archiveMember(userId: string, email: string): Promise<boolean> {
  const db = getDb()
  const now = new Date()
  const isArchived = sql`exists (select 1 from ${users} where ${users.id} = ${userId} and ${users.archivedAt} is not null)`
  const address = email.toLowerCase()

  const [updated] = await db.batch([
    db
      .update(users)
      .set({
        archivedAt: now,
        email: archivedEmail(userId),
        image: null,
        emailVerified: false,
        weeklyFinanceDigest: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, userId),
          isNull(users.archivedAt),
          sql`(${users.role} <> 'admin' or ${anotherAdminExists(userId)})`,
        ),
      )
      .returning({ id: users.id }),
    db.delete(sessions).where(and(eq(sessions.userId, userId), isArchived)),
    db.delete(accounts).where(and(eq(accounts.userId, userId), isArchived)),
    db.delete(userAvatars).where(and(eq(userAvatars.userId, userId), isArchived)),
    db.delete(verifications).where(
      and(
        or(
          eq(verifications.identifier, removalCodeIdentifier(userId)),
          inArray(
            verifications.identifier,
            ['sign-in', 'email-verification', 'forget-password'].map(
              (type) => `${type}-otp-${address}`,
            ),
          ),
        ),
        isArchived,
      ),
    ),
  ])
  return updated.length > 0
}

/**
 * Change a member's role, guarded in SQL like `archiveMember`: never onto an archived
 * row, and never leaving the client without an admin. Sessions are left alone, because
 * `getAuthUser` reads the role off the row on every request, so the change is live on
 * their next click.
 */
export async function changeMemberRole(userId: string, role: MemberRole): Promise<boolean> {
  const rows = await getDb()
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.archivedAt),
        role === 'admin'
          ? undefined
          : sql`(${users.role} <> 'admin' or ${anotherAdminExists(userId)})`,
      ),
    )
    .returning({ id: users.id })
  return rows.length > 0
}
