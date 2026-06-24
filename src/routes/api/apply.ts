import { createFileRoute } from '@tanstack/react-router'
import { ingestApplication } from '../../server/fieldMapping/ingest'
import { authenticateApiKey } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'

// The single public submission entry. A foundation's intake integration posts the raw
// application here, authenticated with `Authorization: Bearer <api key>` (generated on the
// Organisation screen). The key resolves to the owning client; the fields are mapped to
// canonical fields and either creates an application or is held for review. The response
// includes the created application + screening results when one was made.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// The submission body IS the payload — a flat object of the foundation's own field
// names → values. There are no reserved top-level keys (the client comes from the API
// key, and every field including the foundation's application reference is mapped). A
// foundation may post JSON or a form encoding (urlencoded / multipart); form values
// arrive as strings, which the mapper handles natively. Returns null for a body that
// isn't a usable, non-empty object.
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

export const Route = createFileRoute('/api/apply')(
  {
    server: {
      handlers: {
        OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
        POST: async ({ request }: { request: Request }) => {
          // 1. Per-IP backstop on every request — a volumetric guard for the
          //    unauthenticated path (its ceiling sits above the per-client limit, so a
          //    legit single-IP client is bounded by step 3, never tripped here first).
          const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
          if (!(await checkRateLimit('APPLY_IP_LIMITER', ip))) {
            return tooManyRequests()
          }

          // 2. Authenticate — the API key both names the client and proves the caller
          //    may submit as them.
          const auth = await authenticateApiKey(request)
          if (!auth) {
            return jsonResponse({ error: 'Invalid or missing API key' }, 401)
          }

          // 3. Per-client limit — the real per-tenant fairness control for legit traffic.
          if (!(await checkRateLimit('APPLY_KEY_LIMITER', auth.clientId))) {
            return tooManyRequests()
          }

          const payload = await parsePayload(request)
          if (!payload) {
            return jsonResponse({ error: 'Request body must contain application fields' }, 400)
          }

          const result = await ingestApplication({ payload, clientId: auth.clientId })
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
