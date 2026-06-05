import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { invitations, clients } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { sendInvitationEmail } from '../../lib/email'
import { CreateInvitationSchema } from '../../lib/validators/invitation'

export const getInvitationByToken = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const invite = await getDb().query.invitations.findFirst({
      where: (i, { gt }) =>
        and(eq(i.token, data.token), isNull(i.acceptedAt), gt(i.expiresAt, new Date())),
      with: { client: true },
    })
    if (!invite) return null
    return { email: invite.email, clientName: invite.client.name }
  })

export const createInvitation = createServerFn({ method: 'POST' })
  .inputValidator(CreateInvitationSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    if (!user.clientId) throw new Error('No client associated with your account')

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

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

    const [clientData] = await getDb().select().from(clients).where(eq(clients.id, user.clientId))
    if (!clientData) throw new Error('Client not found')
    const baseUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000'

    await sendInvitationEmail({
      to: data.email,
      inviteUrl: `${baseUrl}/sign-up?invite=${token}`,
      clientName: clientData.name,
      inviterName: user.name,
    })

    return invite
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
