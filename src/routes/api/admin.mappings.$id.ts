import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { fieldMappings } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

export const Route = createFileRoute('/api/admin/mappings/$id')(
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

          await getDb().delete(fieldMappings).where(eq(fieldMappings.id, params.id))
          return adminJson({ ok: true }, 200)
        },
      },
    },
  } as any,
)
