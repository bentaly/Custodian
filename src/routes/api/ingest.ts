import { createFileRoute } from '@tanstack/react-router'
import { IngestSchema } from '../../lib/validators/ingest'
import { ingestApplication } from '../../server/fieldMapping/ingest'

// Public entry for foundation form integrations (Zapier etc.) — same exposure as
// /api/apply. The raw payload is mapped to canonical fields; the response reports
// whether an application was created or the submission is awaiting review.
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

export const Route = createFileRoute('/api/ingest')(
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
            if (result.error === 'not_found') return jsonResponse({ error: 'Not found' }, 404)
            return jsonResponse(
              { error: 'This round is not currently open for applications' },
              409,
            )
          }

          return jsonResponse(
            {
              status: result.status,
              ingestId: result.ingestId,
              applicationId: result.applicationId,
              duplicate: result.duplicate,
            },
            result.duplicate ? 200 : 201,
          )
        },
      },
    },
  } as any,
)
