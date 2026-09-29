import { createFileRoute } from '@tanstack/react-router'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { reportIngests } from '../../../drizzle/schema'
import { processReportIngest } from '../../server/reportMapping/ingest'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// Re-run the report pipeline over a report ingest: the twin of
// `admin.ingests.$id.reprocess.ts`, which says why each rule is what it is. Reports had
// no reprocess at all, so a report whose pipeline crashed could only be resolved by hand.
//
// (Application version's notes follow.)
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
//
// Also takes a HELD row with no application yet, which is what the blockers have long
// told an operator to do ("reopen the round, then Reprocess", "add a lookup, then
// Reprocess") while this endpoint refused anything past `received`. Such a row is put
// back to `received` first, by a conditional update, so two presses cannot both run it
// and a row that has since been resolved is left alone.
export const Route = createFileRoute('/api/admin/report-ingests/$id/reprocess')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      POST: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const ingest = await getDb().query.reportIngests.findFirst({
          where: eq(reportIngests.id, params.id),
          columns: { id: true, status: true, reportId: true },
        })
        if (!ingest) return adminJson({ error: 'Not found' }, 404)

        if (ingest.status === 'needs_review') {
          const [reset] = await getDb()
            .update(reportIngests)
            .set({ status: 'received', proposed: null, resolved: null, matchCandidates: null })
            .where(
              and(
                eq(reportIngests.id, params.id),
                eq(reportIngests.status, 'needs_review'),
                isNull(reportIngests.reportId),
              ),
            )
            .returning({ id: reportIngests.id })
          if (!reset) {
            return adminJson(
              { error: 'This report is already attached to a grant.' },
              409,
            )
          }
        } else if (ingest.status !== 'received') {
          // `processIngest` only touches `received` rows, so it is safe to call twice —
          // but say so plainly rather than returning a silent no-op that reads as success.
          return adminJson(
            {
              error: `This submission has already been filed (${ingest.status}). It has already been through the pipeline.`,
            },
            409,
          )
        }

        try {
          const result = await processReportIngest(params.id)
          if (!result.ok) return adminJson({ error: `Could not reprocess: ${result.error}` }, 409)
          return adminJson(
            { ok: true, status: result.status, reportId: result.reportId },
            200,
          )
        } catch (err) {
          // The row stays at `received`, so this is retryable — surface why it failed
          // so an admin can tell a transient blip from a payload that will never map.
          console.error(`[admin] report reprocess ${params.id} failed:`, err)
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
