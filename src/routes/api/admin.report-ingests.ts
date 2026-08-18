import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { reportIngests } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'
import { diagnoseReportIngests } from '../../server/reportMapping/diagnose'
import { autoMappingsForReportIngests } from '../../server/fieldMapping/provenance'

const STATUSES = new Set(['received', 'needs_review', 'ai_proposed', 'complete'])

export const Route = createFileRoute('/api/admin/report-ingests')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      GET: async ({ request }: { request: Request }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const statusParam = new URL(request.url).searchParams.get('status')
        const status = statusParam && STATUSES.has(statusParam) ? statusParam : null

        const rows = await getDb().query.reportIngests.findMany({
          where: status
            ? eq(
                reportIngests.status,
                status as 'received' | 'needs_review' | 'ai_proposed' | 'complete',
              )
            : undefined,
          orderBy: (i, { desc }) => [desc(i.createdAt)],
          with: { client: { columns: { id: true, name: true } } },
        })

        // See admin.ingests.ts — each row explains why it is held, and which of its
        // incoming field names already map themselves so the queue only offers to teach
        // the rest. Reads the `report` half of the lookup table and the report registry.
        const [diagnosis, autoMappings] = await Promise.all([
          diagnoseReportIngests(rows),
          autoMappingsForReportIngests(rows),
        ])
        return adminJson(
          rows.map((row) => ({
            ...row,
            blockers: diagnosis.get(row.id) ?? [],
            autoMappings: autoMappings.get(row.id) ?? {},
          })),
          200,
        )
      },
    },
  },
} as any)
