import { createFileRoute } from '@tanstack/react-router'
import { saveReportIngest, processReportIngest } from '../../server/reportMapping/ingest'
import { runInBackground } from '../../server/background'
import { authenticateApiKey } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'

// The public grant-report submission entry — the report-side twin of /api/apply.
// A foundation's report form posts the charity's answers here, authenticated with
// `Authorization: Bearer <api key>` (the same key as /api/apply; it resolves to the
// owning client). The raw payload is persisted immediately and acknowledged with 202 —
// field mapping, grant matching and AI analysis then run in the background. A report
// is NEVER rejected for content: missing fields or an unmatched grant hold it in the
// admin review queue instead.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// The body IS the payload — a flat object of the foundation's report-form field
// names → values, JSON or form-encoded. No reserved keys: even the application
// reference the report should carry (for auto-matching) is just a mapped field.
async function parsePayload(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? ''
  let payload: Record<string, unknown>
  if (contentType.includes('application/json')) {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return null
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    payload = body as Record<string, unknown>
  } else {
    // application/x-www-form-urlencoded or multipart/form-data.
    try {
      payload = Object.fromEntries(await request.formData())
    } catch {
      return null
    }
  }
  return Object.keys(payload).length > 0 ? payload : null
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function tooManyRequests() {
  return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }), {
    status: 429,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '60' },
  })
}

export const Route = createFileRoute('/api/submit-report')(
  {
    server: {
      handlers: {
        OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
        POST: async ({ request }: { request: Request }) => {
          // Same three-step guard as /api/apply: per-IP backstop → API key → per-client
          // limit. The limiter bindings are shared — reports and applications draw from
          // the same per-tenant budget, which is fine at this traffic.
          const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
          if (!(await checkRateLimit('APPLY_IP_LIMITER', ip))) {
            return tooManyRequests()
          }

          const auth = await authenticateApiKey(request)
          if (!auth) {
            return jsonResponse({ error: 'Invalid or missing API key' }, 401)
          }

          if (!(await checkRateLimit('APPLY_KEY_LIMITER', auth.clientId))) {
            return tooManyRequests()
          }

          const payload = await parsePayload(request)
          if (!payload) {
            return jsonResponse({ error: 'Request body must contain report fields' }, 400)
          }

          // Persist first — once the row exists the report can never be lost — then
          // acknowledge. Mapping, matching and analysis run after the response.
          const ingestId = await saveReportIngest({ clientId: auth.clientId, payload })
          runInBackground(`processReportIngest ${ingestId}`, () => processReportIngest(ingestId))

          return jsonResponse({ status: 'received', ingestId }, 202)
        },
      },
    },
  } as any,
)
