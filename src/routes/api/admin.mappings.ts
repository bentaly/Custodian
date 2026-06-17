import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { fieldMappings } from '../../../drizzle/schema'
import { MappingSchema } from '../../lib/validators/ingest'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

export const Route = createFileRoute('/api/admin/mappings')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        GET: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const clientId = new URL(request.url).searchParams.get('clientId')
          const rows = await getDb().query.fieldMappings.findMany({
            where: clientId ? eq(fieldMappings.clientId, clientId) : undefined,
            orderBy: (m, { asc }) => [asc(m.sourceKey)],
          })
          return adminJson(rows, 200)
        },
        POST: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          let body: unknown
          try {
            body = await request.json()
          } catch {
            return adminJson({ error: 'Invalid JSON' }, 400)
          }

          const parsed = MappingSchema.safeParse(body)
          if (!parsed.success) {
            return adminJson(
              {
                error: 'Invalid request',
                fields: parsed.error.issues.map((i) => ({
                  field: i.path.join('.'),
                  message: i.message,
                })),
              },
              400,
            )
          }

          const { clientId, sourceKey, canonicalField, addedBy } = parsed.data
          const [row] = await getDb()
            .insert(fieldMappings)
            .values({ clientId, sourceKey, canonicalField, addedBy: addedBy ?? null })
            .onConflictDoUpdate({
              target: [fieldMappings.clientId, fieldMappings.sourceKey],
              set: { canonicalField, addedBy: addedBy ?? null },
            })
            .returning()
          return adminJson(row, 200)
        },
      },
    },
  } as any,
)
