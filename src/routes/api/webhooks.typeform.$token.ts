import { createFileRoute } from '@tanstack/react-router'
import { saveIngest, processIngest } from '../../server/fieldMapping/ingest'
import { enqueue } from '../../server/pipelineQueue'
import { authenticateWebhookToken } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'
import { parseSubmissionPayload } from '../../lib/submissionPayload'

// Typeform posts here directly — no integration builder in between.
//
// This is `/api/apply` with one difference, and the difference is not ours: Typeform
// lets you set a webhook URL and nothing else. No custom headers, so no
// `Authorization: Bearer`. The credential therefore travels in the path, which is why
// it is a token of its own kind (`cust_wh_…`) rather than the foundation's API key —
// see `apiKeys.ts`. Everything after authentication is identical, because the envelope
// is already flat by the time it gets here: `parseSubmissionPayload` recognises the
// shape and hands on the same `{ field → value }` object a foundation would have
// posted by hand.
//
// Answers 200 rather than 202. Typeform retries on any non-2xx and shows a delivery
// log to the form's owner, so the code is read by a person; 202 is the honest one but
// 200 is the one their UI treats as unambiguously fine. The body still says `received`.
//
// No CORS headers: nothing browser-side calls this, and a webhook endpoint that
// advertises itself as cross-origin-callable invites a page to post submissions with
// a token lifted from somewhere else.

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/webhooks/typeform/$token')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { token: string } }) => {
        // Per-IP backstop before the token is looked up, exactly as on /api/apply:
        // the path is unauthenticated until the database says otherwise.
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
        if (!(await checkRateLimit('APPLY_IP_LIMITER', ip))) {
          return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
        }

        const auth = await authenticateWebhookToken(params.token)
        if (!auth) {
          return jsonResponse({ error: 'Unknown or revoked webhook token' }, 401)
        }

        if (!(await checkRateLimit('APPLY_KEY_LIMITER', auth.clientId))) {
          return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
        }

        const payload = await parseSubmissionPayload(request)
        if (!payload) {
          // A Typeform "test" delivery sends an envelope with no answers, which
          // flattens to nothing. Saying so beats a bare 400 in their delivery log.
          return jsonResponse({ error: 'Request body contained no answers' }, 400)
        }

        const ingestId = await saveIngest({ clientId: auth.clientId, payload })
        await enqueue({ kind: 'ingest', ingestId }, () => processIngest(ingestId))

        return jsonResponse({ status: 'received', ingestId }, 200)
      },
    },
  },
} as any)
