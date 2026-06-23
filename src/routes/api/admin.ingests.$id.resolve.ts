import { createFileRoute } from '@tanstack/react-router'
import { ResolveSchema } from '../../lib/validators/ingest'
import { resolveIngest } from '../../server/fieldMapping/resolve'
import { adminActor, adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

export const Route = createFileRoute('/api/admin/ingests/$id/resolve')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        POST: async ({
          request,
          params,
        }: {
          request: Request
          params: { id: string }
        }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          let body: unknown
          try {
            body = await request.json()
          } catch {
            return adminJson({ error: 'Invalid JSON' }, 400)
          }

          const parsed = ResolveSchema.safeParse(body)
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

          const result = await resolveIngest(params.id, parsed.data, adminActor(request))
          if (!result.ok) {
            if (result.error === 'not_found') return adminJson({ error: 'Not found' }, 404)
            if (result.error === 'already_resolved')
              return adminJson({ error: 'Already resolved' }, 409)
            if (result.error === 'invalid')
              return adminJson(
                { error: 'Mapping does not produce a valid application', fields: result.fields },
                422,
              )
            return adminJson({ error: 'Round programme no longer exists' }, 409)
          }

          return adminJson({ applicationId: result.applicationId }, 200)
        },
      },
    },
  } as any,
)
