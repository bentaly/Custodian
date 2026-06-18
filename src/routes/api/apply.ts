import { createFileRoute } from '@tanstack/react-router'
import { IngestSchema } from '../../lib/validators/ingest'
import { ingestApplication } from '../../server/fieldMapping/ingest'

// The single public submission entry. A foundation's intake form (a form on their
// own website, or any external integration) posts the raw payload here; it is mapped
// to canonical fields and either creates an application or is held for review. The
// response includes the created application + screening results when one was made.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/apply')(
  {
    server: {
      handlers: {
        OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
        POST: async ({ request }: { request: Request }) => {
          let rawBody: unknown
          try {
            rawBody = await request.json()
          } catch {
            return jsonResponse({ error: 'Invalid JSON' }, 400)
          }

          const parsed = IngestSchema.safeParse(rawBody)
          if (!parsed.success) {
            const fields = parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            }))
            return jsonResponse({ error: 'Missing or invalid fields', fields }, 400)
          }

          const result = await ingestApplication(parsed.data)
          if (!result.ok) {
            return jsonResponse({ error: 'Unknown client' }, 404)
          }

          return jsonResponse(
            {
              status: result.status,
              ingestId: result.ingestId,
              applicationId: result.applicationId,
              // application / dueDiligence / custodian, present when one was created.
              ...(result.created ?? {}),
            },
            201,
          )
        },
      },
    },
  } as any,
)
