import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { forbidden, notFoundError } from '../../lib/errors'
import { getDb } from '../db'
import { recordAudit } from '../audit'
import { requireRole } from '../session'

// Platform (superadmin) read model backing the in-app impersonation console.
// Foundation provisioning lives in the admin app (POST /api/admin/clients) — it is
// token-gated and has no main-app user, whereas impersonation must run here because
// it issues a real same-origin BetterAuth session.

export const listClients = createServerFn({ method: 'GET' }).handler(async () => {
  await requireRole('superadmin')
  return getDb().query.clients.findMany({
    with: {
      users: { columns: { id: true, name: true, email: true, role: true } },
    },
    orderBy: (c, { asc }) => [asc(c.name)],
  })
})

/**
 * Record that a superadmin is about to act as `userId`, and hand back where to land.
 *
 * Called by the console immediately BEFORE `authClient.admin.impersonateUser`, which is
 * the only moment this can be written: BetterAuth swaps the session cookie, so once
 * impersonation has begun the caller is the foundation's member and `requireRole
 * ('superadmin')` would — correctly — refuse. Writing first means a failed handover can
 * leave a row for a session that never opened; that is the safe direction to be wrong
 * in, and far better than the alternative of logging nothing at all.
 *
 * Refuses a target with no `clientId`, which covers both halves of the same fact: there
 * is no foundation to enter, and no tenant to file the row against.
 */
export const startImpersonation = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const actor = await requireRole('superadmin')

    const target = await getDb().query.users.findFirst({
      where: (u, { eq }) => eq(u.id, data.userId),
      columns: { id: true, name: true, email: true, role: true, clientId: true },
    })
    if (!target) throw notFoundError()
    if (!target.clientId) {
      throw forbidden('That account is not attached to a foundation.')
    }

    await recordAudit({
      actorUserId: actor.id,
      action: 'impersonation_started',
      clientId: target.clientId,
      metadata: { targetUserId: target.id, targetName: target.name, targetEmail: target.email },
    })

    return { clientId: target.clientId }
  })
