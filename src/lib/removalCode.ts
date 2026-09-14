// ─── The code that confirms removing your own account ─────────────────────────
//
// Removing your account is the one action in Custodian that a stolen session could
// use to do lasting harm to its owner, so it asks for proof beyond the session: a
// 6-digit code emailed to the address on the account. Everyone can receive one, whether
// they sign in with a password, with Google or with a code, which is why it is a code
// and not "type your password".
//
// It is our own row in `verifications` rather than BetterAuth's emailOTP plugin, on
// purpose. The plugin's send endpoint is public: reusing one of its OTP types would let
// anybody on the internet trigger "confirm removing your account" emails to any member,
// and its verify endpoints would accept the code for other things too. This code is
// only ever issued to a signed-in user, for themselves, and only this flow reads it.
//
// Same limits as the sign-in code: 6 digits, 5 minutes, 3 attempts, stored hashed.

export const REMOVAL_CODE_LENGTH = 6
export const REMOVAL_CODE_TTL_MS = 5 * 60 * 1000
export const REMOVAL_CODE_ATTEMPTS = 3

export function removalCodeIdentifier(userId: string): string {
  return `account-removal:${userId}`
}

/** `hash:attempts`, the shape BetterAuth's own OTP rows use in the same table. */
export function removalCodeValue(hash: string, attempts: number): string {
  return `${hash}:${attempts}`
}

/**
 * SHA-256 of the code, salted with the user id so the same six digits never hash alike
 * for two people. Web Crypto, which both Workers and Node provide.
 */
export async function hashRemovalCode(userId: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}:${code}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateRemovalCode(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1))
  return String(n! % 10 ** REMOVAL_CODE_LENGTH).padStart(REMOVAL_CODE_LENGTH, '0')
}

export type RemovalCodeFailure = 'missing' | 'expired' | 'too_many' | 'wrong'

export type RemovalCodeVerdict =
  | { ok: true }
  /** `nextValue`: what to write back (a wrong guess costs an attempt). `discard`: delete the row. */
  | { ok: false; reason: RemovalCodeFailure; nextValue?: string; discard?: boolean }

export const REMOVAL_CODE_MESSAGES: Record<RemovalCodeFailure, string> = {
  missing: 'Send yourself a code first.',
  expired: 'That code has expired. Send a new one.',
  too_many: 'Too many incorrect attempts. Send a new code.',
  wrong: "That code isn't right. Check it and try again.",
}

export function judgeRemovalCode(input: {
  stored: { value: string; expiresAt: Date } | null
  submittedHash: string
  now: Date
}): RemovalCodeVerdict {
  const { stored, submittedHash, now } = input
  if (!stored) return { ok: false, reason: 'missing' }
  if (stored.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired', discard: true }
  }

  const split = stored.value.lastIndexOf(':')
  const hash = split === -1 ? stored.value : stored.value.slice(0, split)
  const attempts = split === -1 ? 0 : Number.parseInt(stored.value.slice(split + 1), 10) || 0
  if (attempts >= REMOVAL_CODE_ATTEMPTS) return { ok: false, reason: 'too_many', discard: true }

  if (hash !== submittedHash) {
    return { ok: false, reason: 'wrong', nextValue: removalCodeValue(hash, attempts + 1) }
  }
  return { ok: true }
}
