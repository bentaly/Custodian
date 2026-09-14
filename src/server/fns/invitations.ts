import { forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { invitations, clients } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { recordAudit } from '../audit'
import { sendInvitationEmail } from '../../lib/email'
import { CreateInvitationSchema } from '../../lib/validators/invitation'

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export const getInvitationByToken = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const invite = await getDb().query.invitations.findFirst({
      where: (i, { gt }) =>
        and(eq(i.token, data.token), isNull(i.acceptedAt), gt(i.expiresAt, new Date())),
      with: { client: true },
    })
    if (!invite) return null
    return { email: invite.email, clientName: invite.client.name }
  })

async function emailInvite(input: {
  clientId: string
  to: string
  token: string
  inviterName: string
}) {
  const [clientData] = await getDb().select().from(clients).where(eq(clients.id, input.clientId))
  if (!clientData) throw notFoundError('Client not found')
  const baseUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000'

  await sendInvitationEmail({
    to: input.to,
    inviteUrl: `${baseUrl}/sign-up?invite=${input.token}`,
    clientName: clientData.name,
    inviterName: input.inviterName,
  })
}

export const createInvitation = createServerFn({ method: 'POST' })
  .validator(CreateInvitationSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS)

    const [invite] = await getDb()
      .insert(invitations)
      .values({
        clientId: user.clientId,
        email: data.email,
        role: data.role,
        token,
        invitedBy: user.id,
        expiresAt,
      })
      .returning()

    await emailInvite({ clientId: user.clientId, to: data.email, token, inviterName: user.name })

    // Who let them in, and as what. A role can be changed later (`member_role_changed`),
    // so this row answers the question as it stood at the door.
    // Written after the email, so the log doesn't claim an invitation that never left.
    await recordAudit({
      actorUserId: user.id,
      action: 'invitation_sent',
      clientId: user.clientId,
      metadata: { email: data.email, role: data.role },
    })

    return invite
  })

/**
 * Send a pending invitation again, with a NEW token and a fresh seven days.
 *
 * A new token rather than the old link re-sent, so that resending is also the way to
 * kill a link that went somewhere it should not have (forwarded to the wrong person,
 * pasted into a shared doc). It is also the way back from an expired invitation, which
 * otherwise sat in the list with nothing anyone could do about it.
 */
export const resendInvitation = createServerFn({ method: 'POST' })
  .validator(z.object({ invitationId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')

    const token = crypto.randomUUID()
    const [invite] = await getDb()
      .update(invitations)
      .set({ token, expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS) })
      .where(
        and(
          eq(invitations.id, data.invitationId),
          eq(invitations.clientId, user.clientId),
          isNull(invitations.acceptedAt),
        ),
      )
      .returning({ email: invitations.email, role: invitations.role })
    if (!invite) throw notFoundError('That invitation has already been accepted or cancelled.')

    await emailInvite({ clientId: user.clientId, to: invite.email, token, inviterName: user.name })

    await recordAudit({
      actorUserId: user.id,
      action: 'invitation_sent',
      clientId: user.clientId,
      metadata: { email: invite.email, role: invite.role, resent: true },
    })
    return { email: invite.email }
  })

/**
 * Withdraw a pending invitation. The row is deleted: an invitation nobody accepted is
 * not a record of anything, and the audit row keeps who withdrew it and from whom.
 */
export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator(z.object({ invitationId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')

    const [removed] = await getDb()
      .delete(invitations)
      .where(
        and(
          eq(invitations.id, data.invitationId),
          eq(invitations.clientId, user.clientId),
          isNull(invitations.acceptedAt),
        ),
      )
      .returning({ email: invitations.email, role: invitations.role })
    if (!removed) throw notFoundError('That invitation has already been accepted or cancelled.')

    await recordAudit({
      actorUserId: user.id,
      action: 'invitation_revoked',
      clientId: user.clientId,
      metadata: { email: removed.email, role: removed.role },
    })
    return { ok: true }
  })

export const listInvitations = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []

  return getDb().query.invitations.findMany({
    where: (i) => and(eq(i.clientId, user.clientId!), isNull(i.acceptedAt)),
    with: { invitedByUser: true },
    orderBy: (i, { desc }) => [desc(i.createdAt)],
  })
})
