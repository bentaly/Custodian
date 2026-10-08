import { authenticateWebhookToken } from './apiKeys'
import { checkRateLimit } from './rateLimit'
import { parseSubmissionPayload } from '../lib/submissionPayload'
import { saveIngest, processIngest } from './fieldMapping/ingest'
import { saveReportIngest, processReportIngest } from './reportMapping/ingest'
import { enqueue } from './pipelineQueue'

// The door every form-platform webhook route shares: rate limit, the token in the
// path, decode. What the route does with the payload is its own business.
//
// Nothing in here knows which platform posted. `parseSubmissionPayload` recognises the
// envelope by its SHAPE, so a Formstack delivery to the Typeform address would be read
// correctly too; the platform in the URL is for the person pasting it, who should see
// the name of the tool they are using.
//
// Answers 200 rather than 202: a platform's delivery log is read by a person, and 200
// is the code every one of them shows as plainly fine. The body still says `received`.
// No CORS headers: nothing browser-side calls these, and a webhook endpoint that
// advertises itself as cross-origin-callable invites a page to post submissions with
// a token lifted from somewhere else.

export function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function receiveWebhook(
  request: Request,
  token: string,
  receive: (clientId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<Response> {
  // Per-IP backstop before the token is looked up, exactly as on /api/apply: the path
  // is unauthenticated until the database says otherwise.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!(await checkRateLimit('APPLY_IP_LIMITER', ip))) {
    return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
  }

  const auth = await authenticateWebhookToken(token)
  if (!auth) return jsonResponse({ error: 'Unknown or revoked webhook token' }, 401)

  if (!(await checkRateLimit('APPLY_KEY_LIMITER', auth.clientId))) {
    return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429)
  }

  const body = await parseSubmissionPayload(request)
  if (!body.ok) {
    // A platform's "test" delivery carries no answers and flattens to nothing. Saying
    // so beats a bare 400 in their delivery log, and 413 names an oversized body.
    return body.reason === 'too_large'
      ? jsonResponse({ error: 'Request body is too large' }, 413)
      : jsonResponse({ error: 'Request body contained no answers' }, 400)
  }

  return jsonResponse(await receive(auth.clientId, body.payload), 200)
}

/** An application form's delivery: held, then mapped on the pipeline queue. */
export async function receiveApplication(clientId: string, payload: Record<string, unknown>) {
  const ingestId = await saveIngest({ clientId, payload })
  await enqueue({ kind: 'ingest', ingestId }, () => processIngest(ingestId))
  return { status: 'received', ingestId }
}

/** A grant report form's delivery: the report-side twin. */
export async function receiveReport(clientId: string, payload: Record<string, unknown>) {
  const ingestId = await saveReportIngest({ clientId, payload })
  await enqueue({ kind: 'report_ingest', ingestId }, () => processReportIngest(ingestId))
  return { status: 'received', ingestId }
}
