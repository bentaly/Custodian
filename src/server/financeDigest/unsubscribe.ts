// ─── One-click unsubscribe ───────────────────────────────────────────────────
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

const PURPOSE = 'finance-digest-unsubscribe'

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

export async function unsubscribeToken(userId: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await key(),
    new TextEncoder().encode(`${PURPOSE}:${userId}`),
  )
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Constant-time-ish comparison. The token is a MAC, so a length-independent compare is
 * the correct habit even though a timing oracle on an unsubscribe link is not much of
 * a prize.
 */
export async function unsubscribeTokenValid(userId: string, token: string): Promise<boolean> {
  const expected = await unsubscribeToken(userId)
  if (expected.length !== token.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

export async function unsubscribeUrl(baseUrl: string, userId: string): Promise<string> {
  const token = await unsubscribeToken(userId)
  return `${baseUrl}/api/digest-unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`
}
