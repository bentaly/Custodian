/**
 * A tiny time-boxed memo for no-argument server functions, **browser only**.
 *
 * ## Why it refuses to cache on the server
 *
 * A module-level cache lives in the Worker isolate, and one isolate serves many
 * requests from many users across many tenants. Caching a per-user answer there would
 * hand one foundation's admin another foundation's data — the worst bug this codebase
 * could have. SSR therefore always calls through, and the guard is here rather than at
 * each call site so it cannot be forgotten by the next thing that wants caching.
 *
 * ## Why in-flight sharing matters as much as the TTL
 *
 * With `defaultPreload: 'intent'` a run of the mouse across a nav can start half a
 * dozen identical requests inside one animation frame — before any of them has returned
 * and populated the cache. A TTL alone does nothing about that; sharing the promise
 * does.
 *
 * Rejections are never cached: only the fulfilled path writes. A failed call therefore
 * retries on the next navigation with no explicit invalidation.
 */
export interface ClientCache<T> {
  read: () => Promise<T>
  invalidate: () => void
}

export function cacheOnClient<T>(fetcher: () => Promise<T>, ttlMs: number): ClientCache<T> {
  let value: T | undefined
  let storedAt = 0
  let inFlight: Promise<T> | undefined

  return {
    read() {
      if (typeof window === 'undefined') return fetcher()

      if (value !== undefined && Date.now() - storedAt < ttlMs) return Promise.resolve(value)
      if (inFlight) return inFlight

      inFlight = fetcher()
        .then((result) => {
          value = result
          storedAt = Date.now()
          return result
        })
        .finally(() => {
          inFlight = undefined
        })

      return inFlight
    },

    invalidate() {
      value = undefined
      storedAt = 0
      inFlight = undefined
    },
  }
}
