import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { users, invitations } from '../../drizzle/schema'

type ClaimedTenant = { clientId: string; role: typeof invitations.$inferSelect.role }

/**
 * Attach a tenant-less user to a client by consuming a pending invitation.
 *
 * Matches by explicit `token` when supplied (the emailed sign-up link), otherwise
 * by the user's email — this is what lets a Google OAuth user who was invited get
 * attached automatically on first sign-in, without ever clicking the link.
 *
 * Returns the claimed { clientId, role }, or null if there is no valid invite.
 * This is the ONLY path that grants a staff user tenant access; self-serve tenant
 * creation has been removed (invite-only onboarding).
 */
export async function claimPendingInvite(
  user: { id: string; email: string; emailVerified: boolean },
  token?: string,
): Promise<ClaimedTenant | null> {
  // Matching on email alone is only safe when the address was *proven*. Google proves
  // it; a `/api/auth/sign-up/email` caller can type any address it likes and lands here
  // with emailVerified=false. Without this gate, anyone who knows an invited address
  // (staff emails are often public) could sign up as it and have getMe hand them the
  // invite — tenant access, at the invited role, without ever seeing the invite email.
  // The token path needs no such check: possessing a token mailed to that address IS
  // the proof.
  if (!token && !user.emailVerified) return null

  const db = getDb()

  const invite = await db.query.invitations.findFirst({
    where: (i, { and, eq: eqf, isNull, gt }) =>
      and(
        token ? eqf(i.token, token) : eqf(i.email, user.email),
        isNull(i.acceptedAt),
        gt(i.expiresAt, new Date()),
      ),
  })
  if (!invite) return null

  // neon-http can't do interactive transactions (db.transaction), but it supports
  // db.batch(): these two writes are sent together and applied atomically server-side,
  // so a user is never attached to a client without the invite also being consumed.
  await db.batch([
    db
      .update(users)
      .set({
        clientId: invite.clientId,
        role: invite.role,
        // Claiming by token proves the user read a mailbox only that address receives,
        // which is exactly what a verification email would establish — so onboarding
        // needs no separate verification step. (Google users arrive already verified.)
        ...(token ? { emailVerified: true } : {}),
      })
      .where(eq(users.id, user.id)),
    db
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id)),
  ])

  return { clientId: invite.clientId, role: invite.role }
}
