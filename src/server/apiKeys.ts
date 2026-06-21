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

/** Generate a new plaintext key plus its last-4 (for masked display). */
export function generateApiKey(): { key: string; last4: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  // base64url, no padding — 32 url-safe chars.
  const random = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const key = `${KEY_PREFIX}${random}`
  return { key, last4: key.slice(-4) }
}

/** SHA-256 hex of a key. Deterministic so it can be looked up directly. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Mask a key for display from its stored last4, e.g. `cust_sk_••••a1b2`. */
export function maskApiKey(last4: string): string {
  return `${KEY_PREFIX}••••${last4}`
}

/**
 * Resolve the bearer token on a request to the owning clientId, or null if the
 * header is missing or the key is unknown/revoked. Touches `lastUsedAt` on success.
 */
export async function authenticateApiKey(request: Request): Promise<{ clientId: string } | null> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1]!.trim()
  if (!token) return null

  const keyHash = await hashApiKey(token)
  const row = await getDb().query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
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
