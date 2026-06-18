import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { applicationIngests } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

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

          await getDb().delete(applicationIngests).where(eq(applicationIngests.id, params.id))
          return adminJson({ ok: true }, 200)
        },
      },
    },
  } as any,
)
