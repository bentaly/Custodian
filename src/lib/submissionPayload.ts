/**
 * Decoding for the public submission endpoints (`/api/apply`, `/api/submit-report`).
 *
 * Both take the same shape of body: the payload IS the request — a flat object of the
 * foundation's own field names → values, with no reserved keys or envelope.
 *
 * The header is treated as a hint, not as the truth. A Content-Type is a *claim* about
 * the bytes, and senders get it wrong constantly: they omit it, send `text/plain`, or —
 * the common one, because it is curl's default and several integration builders copy it —
 * wrap a JSON body in `application/x-www-form-urlencoded`. Trusting the claim over the
 * bytes turned those into either a 400 for a perfectly well-formed submission, or (worse)
 * a 202 for a payload parsed into a single garbage key holding the whole JSON string.
 * A silent success is the one outcome an integration can never recover from: the sender
 * has a 202 and an ingest id, and nothing usable ever lands.
 *
 * Sniffing is safe here specifically because nothing renders this. The usual objection —
 * MIME confusion becoming XSS — applies to content that is served back; this is parsed
 * into a flat object and validated downstream against the canonical field registry.
 *
 * Liberal about encoding, strict about content: anything that does not decode to a
 * non-empty object still returns null, and the caller still answers 400.
 *
 * Decoding is also where a PLATFORM ENVELOPE is unwrapped. A form platform posts its
 * own nested shape and gives the foundation no way to reshape it, so `readEnvelope`
 * recognises the shape and flattens it to the same `{ field → value }` object a
 * foundation posting from their own server would have sent. It happens here, at the
 * single decode boundary, so every submission endpoint gets it on the same terms and
 * nothing further in sees that envelopes exist.
 */

import { readEnvelope } from './submissionEnvelope'

/** True if the body decoded to something we can actually treat as a payload. */
function orNull(payload: Record<string, unknown>): Record<string, unknown> | null {
  return Object.keys(payload).length > 0 ? payload : null
}

/** Unwrap a recognised platform envelope; pass an ordinary flat payload through. */
function unwrap(payload: Record<string, unknown>): Record<string, unknown> {
  return readEnvelope(payload)?.payload ?? payload
}

export async function parseSubmissionPayload(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()

  // multipart is the one encoding that genuinely needs its header: the boundary string
  // separating the parts is generated per-request and announced nowhere but the header,
  // so the bytes alone cannot be split. Sniffing cannot reach this case, by construction.
  if (contentType.includes('multipart/form-data')) {
    try {
      return orNull(unwrap(Object.fromEntries(await request.formData())))
    } catch {
      return null
    }
  }

  const text = (await request.text()).trim()
  if (!text) return null

  // A body opening with `{` or `[` is JSON or it is broken — never urlencoded. Failing
  // it here rather than falling through matters: URLSearchParams would happily turn
  // malformed JSON into one key named after the entire body, which is exactly the
  // silent-success this function exists to prevent.
  if (text.startsWith('{') || text.startsWith('[')) {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return null
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    return orNull(unwrap(body as Record<string, unknown>))
  }

  // Form encoding. Require a `=`: every real urlencoded body has one, and without the
  // check any stray text body (a plain string, an XML document) decodes to a single
  // key named after itself and is accepted as though it were fields.
  if (!text.includes('=')) return null
  return orNull(unwrap(Object.fromEntries(new URLSearchParams(text))))
}
