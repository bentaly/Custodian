// ─── Submission envelopes ────────────────────────────────────────────────────
//
// `/api/apply` and `/api/submit-report` take a FLAT object of the foundation's own
// field names → values. That is the right contract for a foundation posting from
// their own server, and the wrong one for a form platform, which posts whatever
// envelope it posts and offers no way to reshape it.
//
// Rather than make every foundation stand up a translation layer (a Make scenario,
// a Zapier zap, a lambda) to turn one into the other, we read the envelope here:
// one small reader per platform, each producing the flat object that foundation
// would have sent by hand. Nothing downstream changes — the canonical mapper, the
// tier registry, the review queue and the blockers all see their usual input.
//
// Recognition is by SHAPE, not by a header or a URL: the same reader therefore
// works whether the platform posted to its own webhook route or an integration
// builder forwarded the raw envelope to `/api/apply`. A body that matches no
// platform is passed through untouched, which is the ordinary case.

import { flattenTypeform, isTypeformEnvelope } from './typeform'

export { flattenTypeform, isTypeformEnvelope }

export type EnvelopePlatform = 'typeform'

const READERS: {
  platform: EnvelopePlatform
  matches: (body: Record<string, unknown>) => boolean
  flatten: (body: Record<string, unknown>) => Record<string, unknown> | null
}[] = [{ platform: 'typeform', matches: isTypeformEnvelope, flatten: flattenTypeform }]

export type ReadEnvelopeResult = {
  platform: EnvelopePlatform
  payload: Record<string, unknown>
}

/**
 * Recognise and flatten a platform envelope, or null if the body is not one.
 *
 * Returns null for an envelope we recognise but cannot flatten to anything (a
 * Typeform response with no answers at all). The caller then treats the body as
 * an ordinary flat payload, and it fails the usual "must contain fields" check —
 * an empty submission is refused with a 400 rather than accepted as an empty one.
 */
export function readEnvelope(body: Record<string, unknown>): ReadEnvelopeResult | null {
  for (const reader of READERS) {
    if (!reader.matches(body)) continue
    const payload = reader.flatten(body)
    return payload ? { platform: reader.platform, payload } : null
  }
  return null
}
