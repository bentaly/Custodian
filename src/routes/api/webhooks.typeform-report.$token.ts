import { createFileRoute } from '@tanstack/react-router'
import { saveReportIngest, processReportIngest } from '../../server/reportMapping/ingest'
import { enqueue } from '../../server/pipelineQueue'
import { authenticateWebhookToken } from '../../server/apiKeys'
import { checkRateLimit } from '../../server/rateLimit'
import { parseSubmissionPayload } from '../../lib/submissionPayload'

// Typeform posts a GRANT REPORT here: the report-side twin of
// `/api/webhooks/typeform/<token>`, as `/api/submit-report` is the twin of `/api/apply`.
//
// Same token, different address. The token says WHO (which foundation), the address
// says WHAT (an application or a report), because a Typeform webhook is one URL and
// nothing else, and the form it belongs to is either an application form or a report
// form. Settings → API keys shows both addresses when a webhook token is made.
//
// Before this existed, a report form had no direct route in: `/api/submit-report`
// reads a Typeform envelope but needs an `Authorization` header Typeform cannot send,
// and the only webhook address made APPLICATIONS, so pasting it into a report form
// turned every report into an application.
//
// A report form rarely asks for our reference, so the Typeform "Submission ID" is NOT
// mapped to one here (the report dictionary does not know it). A report links by a
// hidden field carrying the application reference, else by charity number, else it
// waits on the Reports screen for an admin. See `reportMapping/ingest.ts`.
//
// 200 not 202, no CORS: the reasons are on the application route.

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/webhooks/typeform-report/$token')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { token: string } }) => {
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

        const body = await parseSubmissionPayload(request)
        if (!body.ok) {
          return body.reason === 'too_large'
            ? jsonResponse({ error: 'Request body is too large' }, 413)
            : jsonResponse({ error: 'Request body contained no answers' }, 400)
        }

        const ingestId = await saveReportIngest({ clientId: auth.clientId, payload: body.payload })
        await enqueue({ kind: 'report_ingest', ingestId }, () => processReportIngest(ingestId))

        return jsonResponse({ status: 'received', ingestId }, 200)
      },
    },
  },
} as any)
