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
 * non-empty object is `unusable`, and the caller still answers 400.
 *
 * Size is the other thing checked here, and it is checked FIRST. Nothing bounded these
 * bodies before the 2026-08-27 audit: `request.text()` read whatever arrived, and
 * `saveIngest` wrote it verbatim into a jsonb column. A caller holding a webhook token
 * — which travels in a URL, is visible to anyone who can edit the form, and lands in
 * request logs — could post tens of megabytes sixty times a minute and fill the
 * database, at no cost to themselves. `too_large` is answered 413 rather than 400
 * because the two ask the sender for completely different things: one says your fields
 * are wrong, the other says your body is.
 *
 * Decoding is also where a PLATFORM ENVELOPE is unwrapped. A form platform posts its
 * own nested shape and gives the foundation no way to reshape it, so `readEnvelope`
 * recognises the shape and flattens it to the same `{ field → value }` object a
 * foundation posting from their own server would have sent. It happens here, at the
 * single decode boundary, so every submission endpoint gets it on the same terms and
 * nothing further in sees that envelopes exist.
 */

import { readEnvelope } from './submissionEnvelope'

/**
 * The largest submission we will read.
 *
 * Real submissions are tens of kilobytes — a Typeform envelope carries the form
 * definition as well as the answers and still lands well under 100KB. A megabyte is
 * one to two orders of magnitude of headroom, so this rejects abuse without ever
 * being reached by a foundation with a long form and verbose applicants.
 */
export const MAX_SUBMISSION_BYTES = 1_000_000

export type SubmissionBody =
  | { ok: true; payload: Record<string, unknown> }
  /** Decoded to nothing we can treat as fields → 400. */
  | { ok: false; reason: 'unusable' }
  /** Refused before or during the read → 413. */
  | { ok: false; reason: 'too_large' }

const UNUSABLE = { ok: false, reason: 'unusable' } as const
const TOO_LARGE = { ok: false, reason: 'too_large' } as const

/** A decoded object is only a payload if it actually holds fields. */
function asBody(payload: Record<string, unknown>): SubmissionBody {
  return Object.keys(payload).length > 0 ? { ok: true, payload } : UNUSABLE
}

/**
 * Refuse an oversized body before reading it.
 *
 * `Content-Length` is where this is actually enforced: every client that sends a
 * buffered body sets it, so the bytes are refused before they are pulled into the
 * isolate. A chunked body announces no length, and for that case the check after the
 * read is the backstop — by then the memory has been spent, but Cloudflare's own
 * request-body ceiling already bounds how much that can be, and no form platform we
 * integrate with streams its webhooks.
 */
function declaredTooLarge(request: Request): boolean {
  const declared = Number(request.headers.get('content-length'))
  return Number.isFinite(declared) && declared > MAX_SUBMISSION_BYTES
}

/** Unwrap a recognised platform envelope; pass an ordinary flat payload through. */
function unwrap(payload: Record<string, unknown>): Record<string, unknown> {
  return readEnvelope(payload)?.payload ?? payload
}

export async function parseSubmissionPayload(request: Request): Promise<SubmissionBody> {
  if (declaredTooLarge(request)) return TOO_LARGE

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()

  // multipart is the one encoding that genuinely needs its header: the boundary string
  // separating the parts is generated per-request and announced nowhere but the header,
  // so the bytes alone cannot be split. Sniffing cannot reach this case, by construction.
  if (contentType.includes('multipart/form-data')) {
    try {
      return asBody(unwrap(Object.fromEntries(await request.formData())))
    } catch {
      return UNUSABLE
    }
  }

  const raw = await request.text()
  // The backstop for a body that declared no length. Measured in UTF-16 code units
  // rather than bytes — it is a bound, not an accounting, and every character is at
  // least one byte, so this can only ever be stricter than the byte cap it stands in
  // for.
  if (raw.length > MAX_SUBMISSION_BYTES) return TOO_LARGE
  const text = raw.trim()
  if (!text) return UNUSABLE

  // A body opening with `{` or `[` is JSON or it is broken — never urlencoded. Failing
  // it here rather than falling through matters: URLSearchParams would happily turn
  // malformed JSON into one key named after the entire body, which is exactly the
  // silent-success this function exists to prevent.
  if (text.startsWith('{') || text.startsWith('[')) {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return UNUSABLE
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return UNUSABLE
    return asBody(unwrap(body as Record<string, unknown>))
  }

  // Form encoding. Require a `=`: every real urlencoded body has one, and without the
  // check any stray text body (a plain string, an XML document) decodes to a single
  // key named after itself and is accepted as though it were fields.
  if (!text.includes('=')) return UNUSABLE
  return asBody(unwrap(Object.fromEntries(new URLSearchParams(text))))
}
