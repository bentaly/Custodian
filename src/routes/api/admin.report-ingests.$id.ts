import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { grantReports, reportIngests, reportSubmissions } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// Delete a report submission outright: the ingest row and, when one was created
// from it, the report submission too — un-ticking the reporting milestone it had
// satisfied so the grant's schedule doesn't stay falsely marked as received.
export const Route = createFileRoute('/api/admin/report-ingests/$id')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        DELETE: async ({
          request,
          params,
        }: {
          request: Request
          params: { id: string }
        }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const ingest = await getDb().query.reportIngests.findFirst({
            where: eq(reportIngests.id, params.id),
            columns: { id: true, reportSubmissionId: true },
          })
          if (!ingest) return adminJson({ ok: true }, 200)

          let milestoneId: string | null = null
          if (ingest.reportSubmissionId) {
            const submission = await getDb().query.reportSubmissions.findFirst({
              where: eq(reportSubmissions.id, ingest.reportSubmissionId),
              columns: { grantReportId: true },
            })
            milestoneId = submission?.grantReportId ?? null
          }

          // FK order: the ingest references the submission, so it goes first.
          await getDb().delete(reportIngests).where(eq(reportIngests.id, params.id))
          if (ingest.reportSubmissionId) {
            await getDb()
              .delete(reportSubmissions)
              .where(eq(reportSubmissions.id, ingest.reportSubmissionId))
          }
          if (milestoneId) {
            await getDb()
              .update(grantReports)
              .set({ submittedDate: null })
              .where(eq(grantReports.id, milestoneId))
          }
          return adminJson({ ok: true }, 200)
        },
      },
    },
  } as any,
)
