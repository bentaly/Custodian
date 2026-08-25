// ─── API key auth for /api/apply ─────────────────────────────────────────────
//
// A foundation's intake integration authenticates to the public submission endpoint
// with `Authorization: Bearer <key>`. The key both names the client and proves the
// caller may submit as them (the old `clientId` body field was an identifier with no
// secret — anyone who learned a UUID could post). Keys are high-entropy random tokens,
// so we store a fast SHA-256 hash (not bcrypt): lookup is a single indexed query on
// every request. The plaintext is shown once at creation and never persisted.

import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from './db'
import { apiKeys } from '../../drizzle/schema'

const KEY_PREFIX = 'cust_sk_'
const WEBHOOK_PREFIX = 'cust_wh_'

function randomToken(prefix: string): { key: string; last4: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  // base64url, no padding — 32 url-safe chars, and url-safe is load-bearing for the
  // webhook variant: the token is a PATH SEGMENT, so a `+` or `/` from plain base64
  // would either re-encode or split the path.
  const random = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const key = `${prefix}${random}`
  return { key, last4: key.slice(-4) }
}

/** Generate a new plaintext key plus its last-4 (for masked display). */
export function generateApiKey(): { key: string; last4: string } {
  return randomToken(KEY_PREFIX)
}

/**
 * Generate a webhook token — the same secret, delivered in a URL because form
 * platforms cannot set headers. Same entropy and the same one-time display; a
 * different prefix so a token pasted into the wrong box is recognisably wrong.
 */
export function generateWebhookToken(): { key: string; last4: string } {
  return randomToken(WEBHOOK_PREFIX)
}

/** SHA-256 hex of a key. Deterministic so it can be looked up directly. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolve a plaintext token of one kind to its owning client, or null if it is
 * unknown, revoked, or of the OTHER kind. Touches `lastUsedAt` on success.
 *
 * The kind is part of the lookup, not a property of the row read afterwards: a
 * webhook token is exposed in a URL and a header key is not, so a leaked webhook
 * URL must not become a working Authorization header, and a header key must not
 * become a URL anyone can replay from a log.
 */
async function resolveToken(
  token: string,
  kind: 'secret' | 'webhook',
): Promise<{ clientId: string } | null> {
  const keyHash = await hashApiKey(token)
  const row = await getDb().query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.kind, kind), isNull(apiKeys.revokedAt)),
    columns: { id: true, clientId: true },
  })
  if (!row) return null

  // Best-effort last-used stamp; never block submission on it.
  try {
    await getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
  } catch {
    /* ignore */
  }

  return { clientId: row.clientId }
}

/**
 * Resolve the bearer token on a request to the owning clientId, or null if the
 * header is missing or the key is unknown/revoked.
 */
export async function authenticateApiKey(request: Request): Promise<{ clientId: string } | null> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1]!.trim()
  if (!token) return null
  return resolveToken(token, 'secret')
}

/** Resolve a webhook token taken from the URL path to its owning clientId. */
export async function authenticateWebhookToken(
  token: string | undefined,
): Promise<{ clientId: string } | null> {
  const trimmed = token?.trim()
  if (!trimmed) return null
  return resolveToken(trimmed, 'webhook')
}
