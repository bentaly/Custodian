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
  user: { id: string; email: string },
  token?: string,
): Promise<ClaimedTenant | null> {
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

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ clientId: invite.clientId, role: invite.role })
      .where(eq(users.id, user.id))
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id))
  })

  return { clientId: invite.clientId, role: invite.role }
}
