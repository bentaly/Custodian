import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { applicationIngests } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'
import { diagnoseIngests } from '../../server/fieldMapping/diagnose'

const STATUSES = new Set(['received', 'needs_review', 'ai_proposed', 'complete'])

export const Route = createFileRoute('/api/admin/ingests')({
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

        // Each row carries WHY it is where it is. Derived here rather than in the
        // admin app because the reasons come from the validators and the programme
        // table, neither of which the admin app can see — and a hand-maintained copy
        // over there is exactly the drift the canonical-fields endpoint exists to avoid.
        const diagnosis = await diagnoseIngests(rows)
        return adminJson(
          rows.map((row) => ({ ...row, blockers: diagnosis.get(row.id) ?? [] })),
          200,
        )
      },
    },
  },
} as any)
