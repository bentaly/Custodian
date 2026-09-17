// ─── One-click unsubscribe, for both weekly digests ──────────────────────────
//
// A recurring email needs an off switch that works from the email itself, without a
// sign-in. Not (only) politeness: an unsubscribe people cannot find is answered with
// the "junk" button instead, and enough of those damage the sending reputation of
// custodian.fund — which is the same domain that carries award letters to grantees.
// DMARC there is still `p=none`, so there is no headroom to spend.
//
// The link is an HMAC over the user id, keyed on BETTER_AUTH_SECRET. That makes it
// unguessable and unforgeable without giving it any of a session's power: the only
// thing it can do is set one boolean to false, and doing so to somebody else is a
// prank, not an escalation. No expiry — an unsubscribe link must still work in a
// six-month-old email, which is precisely when someone reaches for it.
//
// Shared by the two weekly digests and the new-awards email, which is why it lives here
// rather than under any one feature's folder. The KIND is signed into the MAC, so a
// payments link cannot be edited into one that switches off reports or new-award
// alerts: they are separate subscriptions and each must be turned off on its own. The payments purpose
// string is left byte-for-byte as it shipped, because every link in every digest
// already sent is a MAC over it.

/** Which subscription a link turns off. The value is part of the signed payload. */
export type DigestKind = 'finance' | 'reports' | 'awards'

const PURPOSE: Record<DigestKind, string> = {
  finance: 'finance-digest-unsubscribe',
  reports: 'reports-digest-unsubscribe',
  awards: 'award-notifications-unsubscribe',
}

async function key(): Promise<CryptoKey> {
  const secret = process.env['BETTER_AUTH_SECRET']
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set — cannot sign unsubscribe links')
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

export async function unsubscribeToken(
  userId: string,
  kind: DigestKind = 'finance',
): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await key(),
    new TextEncoder().encode(`${PURPOSE[kind]}:${userId}`),
  )
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Constant-time-ish comparison. The token is a MAC, so a length-independent compare is
 * the correct habit even though a timing oracle on an unsubscribe link is not much of
 * a prize.
 */
export async function unsubscribeTokenValid(
  userId: string,
  token: string,
  kind: DigestKind = 'finance',
): Promise<boolean> {
  const expected = await unsubscribeToken(userId, kind)
  if (expected.length !== token.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

/**
 * The link for the footer.
 *
 * `kind` defaults to `finance` and the query parameter is OMITTED for it, so the URL is
 * character-identical to the one the payments digest has always emitted. Reports links
 * carry `&k=reports`; a link with no `k` is read as payments, which is what makes every
 * digest already in somebody's inbox keep working.
 */
export async function unsubscribeUrl(
  baseUrl: string,
  userId: string,
  kind: DigestKind = 'finance',
): Promise<string> {
  const token = await unsubscribeToken(userId, kind)
  const suffix = kind === 'finance' ? '' : `&k=${kind}`
  return `${baseUrl}/api/digest-unsubscribe?u=${encodeURIComponent(userId)}&t=${token}${suffix}`
}
