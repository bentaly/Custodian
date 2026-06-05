import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { clients, users, invitations } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'

export const completeRegistration = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      clientName: z.string().min(1).optional(),
      inviteToken: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    if (user.clientId) return user

    if (data.inviteToken) {
      const invite = await getDb().query.invitations.findFirst({
        where: (i, { and, isNull, gt }) =>
          and(eq(i.token, data.inviteToken!), isNull(i.acceptedAt), gt(i.expiresAt, new Date())),
      })
      if (!invite) throw new Error('Invalid or expired invitation')

      await getDb().transaction(async (tx) => {
        await tx
          .update(users)
          .set({ clientId: invite.clientId, role: invite.role })
          .where(eq(users.id, user.id))

        await tx
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invite.id))
      })

      return { ...user, clientId: invite.clientId, role: invite.role }
    }

    if (data.clientName) {
      const [client] = await getDb()
        .insert(clients)
        .values({ name: data.clientName })
        .returning()
      if (!client) throw new Error('Failed to create client')

      await getDb().update(users).set({ clientId: client.id, role: 'admin' }).where(eq(users.id, user.id))

      return { ...user, clientId: client!.id, role: 'admin' as const }
    }

    throw new Error('Either clientName or inviteToken is required')
  })
