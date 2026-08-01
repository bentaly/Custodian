import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { applicationIngests } from '../../../drizzle/schema'
import { processIngest } from '../../server/fieldMapping/ingest'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// Re-run the mapping pipeline over an ingest whose background run never finished.
//
// `/api/apply` answers 202 and hands the pipeline to `runInBackground`. If that run
// dies — a transient AI/register error, or the Worker invocation being torn down — the
// row is left at `received` with nothing else written. Until this endpoint existed the
// only action available on such a row was Delete, which throws the submission away; the
// alternative was rescuing it by hand with database credentials.
//
// Runs INLINE rather than in the background, unlike the original submission: this is a
// human waiting on a button, and the whole point is to find out whether it worked. A
// failure returns its reason rather than vanishing into the logs.
export const Route = createFileRoute('/api/admin/ingests/$id/reprocess')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      POST: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const ingest = await getDb().query.applicationIngests.findFirst({
          where: eq(applicationIngests.id, params.id),
          columns: { id: true, status: true },
        })
        if (!ingest) return adminJson({ error: 'Not found' }, 404)

        // `processIngest` only touches `received` rows, so it is safe to call twice —
        // but say so plainly rather than returning a silent no-op that reads as success.
        if (ingest.status !== 'received') {
          return adminJson(
            {
              error: `This submission has already been processed (${ingest.status}). Only a submission stuck at "received" can be reprocessed.`,
            },
            409,
          )
        }

        try {
          const result = await processIngest(params.id)
          if (!result.ok) return adminJson({ error: `Could not reprocess: ${result.error}` }, 409)
          return adminJson(
            { ok: true, status: result.status, applicationId: result.applicationId },
            200,
          )
        } catch (err) {
          // The row stays at `received`, so this is retryable — surface why it failed
          // so an admin can tell a transient blip from a payload that will never map.
          console.error(`[admin] reprocess ${params.id} failed:`, err)
          return adminJson(
            {
              error:
                err instanceof Error
                  ? `Pipeline failed: ${err.message}`
                  : 'The pipeline failed for an unknown reason.',
            },
            500,
          )
        }
      },
    },
  },
} as any)
