// ─── Rate limiting ───────────────────────────────────────────────────────────
//
// Thin wrapper over Cloudflare Workers' rate-limit bindings (declared in
// wrangler.toml as `[[unsafe.bindings]]` of type "ratelimit"). The bindings are
// objects, not strings, so they don't arrive via process.env — worker-entry.js
// stashes the live `env` on globalThis.__cfEnv and we read the limiter from there.
//
// Degrades open: if the binding is absent (local `pnpm dev`, or before the binding
// is provisioned) every call is allowed, mirroring how AI scoring/mapping degrade
// when their key is missing. So this is safe to ship before the binding exists.

interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>
}

function getLimiter(name: string): RateLimiter | null {
  const env = (globalThis as { __cfEnv?: Record<string, unknown> }).__cfEnv
  const binding = env?.[name]
  if (binding && typeof (binding as RateLimiter).limit === 'function') {
    return binding as RateLimiter
  }
  return null
}

/**
 * Returns true if the request may proceed, false if it has exceeded the limit.
 * `name` is the binding name; `key` is the bucket (an API key's client id, an IP, …).
 */
export async function checkRateLimit(name: string, key: string): Promise<boolean> {
  const limiter = getLimiter(name)
  if (!limiter) return true // no binding configured → degrade open
  try {
    const { success } = await limiter.limit({ key })
    return success
  } catch {
    return true // never block submissions on a limiter failure
  }
}
