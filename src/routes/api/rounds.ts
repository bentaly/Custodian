// Round metadata for the admin app's Testing and Field-mappings screens.
//
// NOT public, despite the shape. It spans every tenant by design — the admin app
// operates all foundations — which is exactly why it is gated by `x-admin-token`
// like the rest of `/api/admin/*`. It was unauthenticated until the 2026-08-27
// audit, at which point `GET /api/rounds` returned every foundation on the
// platform, by name, to anyone who asked. Nothing browser-side outside the
// Cloudflare Access-gated admin app has ever called it.
import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import { rounds } from '../../../drizzle/schema'
import { asc } from 'drizzle-orm'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

export const Route = createFileRoute('/api/rounds')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      GET: async ({ request }: { request: Request }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const allRounds = await getDb().query.rounds.findMany({
          columns: { id: true, name: true, openedAt: true, closedAt: true },
          with: { client: { columns: { id: true, name: true } } },
          orderBy: [asc(rounds.createdAt)],
        })

        return adminJson(allRounds, 200)
      },
    },
  },
} as any)
