// ─── The reference an invitation carries, and how it comes back ──────────────
//
// Custodian hosts no forms. "Invite to submit an EOI" and "Invite to apply" email a link
// to the FOUNDATION's own form, and what is submitted there comes back through the
// ordinary intake (`/api/apply`, `/api/eoi`, the Typeform webhooks). So the only way to
// tie a submission to the partnership or EOI that prompted it is for the link to carry a
// reference out and for the form to hand it back as one more field.
//
// That field is `custodian_ref`. On Typeform it is a hidden field (declared on the form
// once, filled from the URL, and merged into the payload by `flattenTypeform`); on any
// other form the foundation forwards the query parameter as a field of the same name.
// A form that does neither still works: the submission arrives unlinked and an admin
// links it by hand, which is where every foundation starts.
//
// Pure. The value is a kind letter and the row's id: `p_<uuid>` for a partnership,
// `e_<uuid>` for an EOI. It is NOT a secret and grants nothing: a reference is only
// honoured for a row belonging to the same foundation the submission was authenticated
// as, so a guessed or copied one can at worst link an organisation's own application to
// a record about some other organisation in the same foundation, visibly, and reversibly.

export const INVITE_REF_KEY = 'custodian_ref'

export type InviteRef = { kind: 'partnership' | 'eoi'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function inviteRef(ref: InviteRef): string {
  return `${ref.kind === 'partnership' ? 'p' : 'e'}_${ref.id}`
}

/** Read a reference back, or null for anything that is not one. Never throws. */
export function parseInviteRef(value: unknown): InviteRef | null {
  if (typeof value !== 'string') return null
  const match = /^([pe])_(.+)$/.exec(value.trim())
  if (!match || !UUID.test(match[2]!)) return null
  return { kind: match[1] === 'p' ? 'partnership' : 'eoi', id: match[2]!.toLowerCase() }
}

/** `custodian_ref`, `Custodian ref` and `custodianRef` are one field name. */
function isRefKey(key: string): boolean {
  return key.toLowerCase().replace(/[^a-z]/g, '') === 'custodianref'
}

/** The payload key holding the reference, if the form handed one back. */
export function inviteRefKey(payload: Record<string, unknown>): string | null {
  return Object.keys(payload).find(isRefKey) ?? null
}

/** The reference a submission carries, or null when it carries none we can read. */
export function findInviteRef(payload: Record<string, unknown>): InviteRef | null {
  const key = inviteRefKey(payload)
  return key ? parseInviteRef(payload[key]) : null
}

/**
 * The form's address with the reference on it, or null when the address is not one.
 *
 * Typeform reads hidden fields from the FRAGMENT (`#custodian_ref=…`), which never
 * reaches their servers' logs; every other form gets a query parameter, which is what a
 * foundation's own site can read and forward. An address that already carries one is
 * replaced rather than doubled.
 */
export function withInviteRef(url: string, ref: InviteRef): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const value = inviteRef(ref)

  if (/(^|\.)typeform\.com$/i.test(parsed.hostname)) {
    const hidden = new URLSearchParams(parsed.hash.replace(/^#/, ''))
    hidden.set(INVITE_REF_KEY, value)
    parsed.hash = hidden.toString()
    return parsed.toString()
  }
  parsed.searchParams.set(INVITE_REF_KEY, value)
  return parsed.toString()
}
