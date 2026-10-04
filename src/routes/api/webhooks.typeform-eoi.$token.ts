import { createFileRoute } from '@tanstack/react-router'
import { receiveEoi } from '../../server/eois/receive'
import { features } from '../../server/features'
import { authenticateWebhookToken } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'
import { parseSubmissionPayload } from '../../lib/submissionPayload'

// A Typeform EXPRESSION OF INTEREST form posts here. The third address a webhook token
// has, beside the application and report ones, and for the same reason the report one
// exists: Typeform takes an address and nothing else, so the address is the only way to
// say which kind of form this is. Pasted into the application address, every EOI would
// be held as an application missing its required fields.
//
// Answers 200, as the other two do: Typeform's delivery log is read by a person.

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/webhooks/typeform-eoi/$token')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { token: string } }) => {
        // Behind the `sourcing` flag: on production this address does not exist yet.
        if (!features().sourcing) return new Response('Not found', { status: 404 })
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
        if (!(await checkRateLimit('APPLY_IP_LIMITER', ip))) {
          return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
        }

        const auth = await authenticateWebhookToken(params.token)
        if (!auth) return jsonResponse({ error: 'Unknown or revoked webhook token' }, 401)

        if (!(await checkRateLimit('APPLY_KEY_LIMITER', auth.clientId))) {
          return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
        }

        const body = await parseSubmissionPayload(request)
        if (!body.ok) {
          return body.reason === 'too_large'
            ? jsonResponse({ error: 'Request body is too large' }, 413)
            : jsonResponse({ error: 'Request body contained no answers' }, 400)
        }

        const { id, duplicate } = await receiveEoi({
          clientId: auth.clientId,
          payload: body.payload,
        })
        return jsonResponse({ status: duplicate ? 'already_received' : 'received', eoiId: id }, 200)
      },
    },
  },
} as any)
