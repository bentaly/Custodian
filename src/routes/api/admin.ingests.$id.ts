import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import {
  applicationComments,
  applicationIngests,
  applicationVotes,
  applications,
  awards,
} from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// Delete a submission outright: the ingest row and, when one was created from it,
// the application too. Refused when a grant has been awarded against the application,
// or when trustees have voted or commented on it: votes and comments cascade on delete
// and they are the record of a decision (the same reason removing a member archives
// rather than deletes). Past that point it is a live foundation's work, not disposable
// test data, and the foundation declines it in Custodian instead.
export const Route = createFileRoute('/api/admin/ingests/$id')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      DELETE: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const ingest = await getDb().query.applicationIngests.findFirst({
          where: eq(applicationIngests.id, params.id),
          columns: { id: true, applicationId: true },
        })
        if (!ingest) return adminJson({ ok: true }, 200)

        if (ingest.applicationId) {
          const grant = await getDb().query.awards.findFirst({
            where: eq(awards.applicationId, ingest.applicationId),
            columns: { id: true },
          })
          if (grant) {
            return adminJson(
              { error: 'Application has an awarded grant and cannot be deleted' },
              409,
            )
          }
          const [vote, comment] = await Promise.all([
            getDb().query.applicationVotes.findFirst({
              where: eq(applicationVotes.applicationId, ingest.applicationId),
              columns: { id: true },
            }),
            getDb().query.applicationComments.findFirst({
              where: eq(applicationComments.applicationId, ingest.applicationId),
              columns: { id: true },
            }),
          ])
          if (vote || comment) {
            return adminJson(
              {
                error:
                  'Trustees have voted or commented on this application, so deleting it would delete their decision record. Decline it in Custodian instead.',
              },
              409,
            )
          }
        }

        await getDb().delete(applicationIngests).where(eq(applicationIngests.id, params.id))
        if (ingest.applicationId) {
          await getDb().delete(applications).where(eq(applications.id, ingest.applicationId))
        }
        return adminJson({ ok: true }, 200)
      },
    },
  },
} as any)
