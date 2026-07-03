import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { applicationIngests } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

const STATUSES = new Set(['received', 'needs_review', 'ai_proposed', 'complete'])

export const Route = createFileRoute('/api/admin/ingests')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        GET: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const statusParam = new URL(request.url).searchParams.get('status')
          const status = statusParam && STATUSES.has(statusParam) ? statusParam : null

          const rows = await getDb().query.applicationIngests.findMany({
            where: status
              ? eq(
                  applicationIngests.status,
                  status as 'received' | 'needs_review' | 'ai_proposed' | 'complete',
                )
              : undefined,
            orderBy: (i, { desc }) => [desc(i.createdAt)],
            with: { client: { columns: { id: true, name: true } } },
          })
          return adminJson(rows, 200)
        },
      },
    },
  } as any,
)
