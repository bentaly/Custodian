import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { applicationIngests, applications, grants } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// Delete a submission outright: the ingest row and, when one was created from it,
// the application too (comments and votes cascade). Refused when a grant has been
// awarded against the application — that is no longer disposable test data.
export const Route = createFileRoute('/api/admin/ingests/$id')(
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

          const ingest = await getDb().query.applicationIngests.findFirst({
            where: eq(applicationIngests.id, params.id),
            columns: { id: true, applicationId: true },
          })
          if (!ingest) return adminJson({ ok: true }, 200)

          if (ingest.applicationId) {
            const grant = await getDb().query.grants.findFirst({
              where: eq(grants.applicationId, ingest.applicationId),
              columns: { id: true },
            })
            if (grant) {
              return adminJson(
                { error: 'Application has an awarded grant and cannot be deleted' },
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
  } as any,
)
