import { createFileRoute } from '@tanstack/react-router'
import { saveIngest, processIngest } from '../../server/fieldMapping/ingest'
import { enqueue } from '../../server/pipelineQueue'
import { authenticateApiKey } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'
import { parseSubmissionPayload } from '../../lib/submissionPayload'

// The single public submission entry. A foundation's intake integration posts the raw
// application here, authenticated with `Authorization: Bearer <api key>` (generated on the
// Organisation screen). The key resolves to the owning client. The raw payload is persisted
// immediately and acknowledged with 202 — field mapping, scoring and due diligence then run
// in the background (they involve LLM and external-register calls that take tens of seconds,
// far longer than a sender's webhook timeout). Senders learn only that the submission was
// accepted; outcomes live in the admin review queue and the app.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// The submission body IS the payload — a flat object of the foundation's own field
// names → values. There are no reserved top-level keys (the client comes from the API
// key, and every field including the foundation's application reference is mapped). A
// foundation may post JSON or a form encoding (urlencoded / multipart); form values
// arrive as strings, which the mapper handles natively. Decoding is shared with
// /api/submit-report — see `parseSubmissionPayload` for why the body, not the
// Content-Type header, decides how it is read.

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

export const Route = createFileRoute('/api/apply')({
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

        const body = await parseSubmissionPayload(request)
        if (!body.ok) {
          return body.reason === 'too_large'
            ? jsonResponse({ error: 'Request body is too large' }, 413)
            : jsonResponse({ error: 'Request body must contain application fields' }, 400)
        }
        const payload = body.payload

        // Persist first — once the row exists the submission can never be lost —
        // then acknowledge. The pipeline (mapping → AI fallback → due diligence)
        // runs after the response; its outcome lands on the ingest row.
        //
        // It runs on a QUEUE rather than under `ctx.waitUntil`, because waitUntil is
        // cancelled 30 seconds after the response and this pipeline is longer than
        // that. When the queue binding is absent (local dev) `enqueue` falls back to
        // background work, which is what this line used to do outright.
        const ingestId = await saveIngest({ clientId: auth.clientId, payload })
        await enqueue({ kind: 'ingest', ingestId }, () => processIngest(ingestId))

        return jsonResponse({ status: 'received', ingestId }, 202)
      },
    },
  },
} as any)
