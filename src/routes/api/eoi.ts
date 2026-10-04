import { createFileRoute } from '@tanstack/react-router'
import { receiveEoi } from '../../server/eois/receive'
import { features } from '../../server/features'
import { authenticateApiKey } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'
import { parseSubmissionPayload } from '../../lib/submissionPayload'

// The expression-of-interest twin of `/api/apply`: same key, same door, same body (a flat
// object of the foundation's own field names, JSON or form-encoded). What differs is
// behind it. An application is saved and then mapped, screened and scored on a queue; an
// EOI is read and written in this request, because nothing about it is slow and nothing
// can hold it. See `server/eois/receive.ts`.
//
// So the answer is 201 with the row's id, not 202: by the time it is sent, the EOI is on
// the foundation's screen. A re-send answers 200 with the id of the one already there.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(data: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  })
}

export const Route = createFileRoute('/api/eoi')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }: { request: Request }) => {
        // Behind the `sourcing` flag: on production this address does not exist yet.
        if (!features().sourcing) return new Response('Not found', { status: 404 })
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
        if (!(await checkRateLimit('APPLY_IP_LIMITER', ip))) {
          return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429, {
            'Retry-After': '60',
          })
        }

        const auth = await authenticateApiKey(request)
        if (!auth) return jsonResponse({ error: 'Invalid or missing API key' }, 401)

        if (!(await checkRateLimit('APPLY_KEY_LIMITER', auth.clientId))) {
          return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429, {
            'Retry-After': '60',
          })
        }

        const body = await parseSubmissionPayload(request)
        if (!body.ok) {
          return body.reason === 'too_large'
            ? jsonResponse({ error: 'Request body is too large' }, 413)
            : jsonResponse({ error: 'Request body must contain the form fields' }, 400)
        }

        const { id, duplicate } = await receiveEoi({
          clientId: auth.clientId,
          payload: body.payload,
        })
        return jsonResponse(
          { status: duplicate ? 'already_received' : 'received', eoiId: id },
          duplicate ? 200 : 201,
        )
      },
    },
  },
} as any)
