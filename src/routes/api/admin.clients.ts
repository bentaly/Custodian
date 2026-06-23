import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getDb } from '../../server/db'
import { clients, invitations } from '../../../drizzle/schema'
import { sendInvitationEmail } from '../../lib/email'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// Foundation provisioning for the (Cloudflare-Access-gated) admin app: create a
// tenant and invite its first admin. Token-gated like the other admin endpoints,
// so there is no main-app user to attribute — invitations.invitedBy is left null.

const CreateClientSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['charitable_foundation', 'family_office']).default('charitable_foundation'),
  adminEmail: z.string().email(),
})

export const Route = createFileRoute('/api/admin/clients')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        GET: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const rows = await getDb().query.clients.findMany({
            with: { users: { columns: { id: true, name: true, email: true, role: true } } },
            orderBy: (c, { asc }) => [asc(c.name)],
          })
          return adminJson(rows, 200)
        },
        POST: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          let body: unknown
          try {
            body = await request.json()
          } catch {
            return adminJson({ error: 'Invalid JSON' }, 400)
          }

          const parsed = CreateClientSchema.safeParse(body)
          if (!parsed.success) {
            return adminJson(
              {
                error: 'Invalid request',
                fields: parsed.error.issues.map((i) => ({
                  field: i.path.join('.'),
                  message: i.message,
                })),
              },
              400,
            )
          }

          const { name, type, adminEmail } = parsed.data
          const db = getDb()

          // Forwarded by the (Cloudflare-Access-gated) admin app so we record which
          // Canvas operator provisioned this — the API itself only sees the shared
          // token, so this is a trusted-infrastructure assertion, not verified here.
          const actorEmail = request.headers.get('x-admin-actor')

          const [client] = await db
            .insert(clients)
            .values({ name, type, createdByEmail: actorEmail })
            .returning()
          if (!client) return adminJson({ error: 'Failed to create client' }, 500)

          const token = crypto.randomUUID()
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          await db.insert(invitations).values({
            clientId: client.id,
            email: adminEmail,
            role: 'admin',
            token,
            invitedBy: null,
            invitedByEmail: actorEmail,
            expiresAt,
          })

          const baseUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000'
          const inviteUrl = `${baseUrl}/sign-up?invite=${token}`

          // Best-effort: the foundation + invite are persisted, so a failing email
          // (e.g. Resend domain not yet verified) must not fail provisioning.
          try {
            await sendInvitationEmail({
              to: adminEmail,
              inviteUrl,
              clientName: client.name,
              inviterName: 'Custodian',
            })
          } catch (err) {
            console.warn('Failed to send invitation email (provisioning still succeeded):', err)
          }

          return adminJson({ client, inviteUrl }, 200)
        },
      },
    },
  } as any,
)
