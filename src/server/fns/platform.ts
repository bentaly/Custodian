import { createServerFn } from '@tanstack/react-start'
import { getDb } from '../db'
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
