import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { reportSchedule, reportIngests, reports } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'
import { recomputeAwardStatus } from '../../server/awards/status'

// Delete a report submission outright: the ingest row and, when one was created
// from it, the report submission too — un-ticking the reporting milestone it had
// satisfied so the grant's schedule doesn't stay falsely marked as received.
export const Route = createFileRoute('/api/admin/report-ingests/$id')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      DELETE: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const ingest = await getDb().query.reportIngests.findFirst({
          where: eq(reportIngests.id, params.id),
          columns: { id: true, reportId: true },
        })
        if (!ingest) return adminJson({ ok: true }, 200)

        let milestoneId: string | null = null
        // The grant is read BEFORE the delete because it is unreachable afterwards, and
        // its lifecycle has to be re-derived once the report is gone — withdrawing a
        // report un-ticks its milestone and takes back whatever sign-off it carried, so
        // a grant marked complete on the strength of it is complete no longer.
        let awardId: string | null = null
        if (ingest.reportId) {
          const submission = await getDb().query.reports.findFirst({
            where: eq(reports.id, ingest.reportId),
            columns: { scheduleId: true, awardId: true },
          })
          milestoneId = submission?.scheduleId ?? null
          awardId = submission?.awardId ?? null
        }

        // FK order: the ingest references the submission, so it goes first.
        await getDb().delete(reportIngests).where(eq(reportIngests.id, params.id))
        if (ingest.reportId) {
          await getDb().delete(reports).where(eq(reports.id, ingest.reportId))
        }
        if (milestoneId) {
          await getDb()
            .update(reportSchedule)
            .set({ submittedDate: null })
            .where(eq(reportSchedule.id, milestoneId))
        }
        if (awardId) await recomputeAwardStatus(awardId)
        return adminJson({ ok: true }, 200)
      },
    },
  },
} as any)
