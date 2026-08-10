/**
 * A deadline on every request the browser makes to our own server.
 *
 * ## Why this exists
 *
 * The server already bounds its database queries (`src/server/db.ts`), so in almost
 * every case it answers — with a real, specific error — within about nine seconds. This
 * covers the one case that bound cannot: the *response* going missing. On 9 Aug 2026 an
 * INSERT committed in the database and its answer never arrived, so nothing on the
 * server had failed, nothing was logged, and the browser sat on a "Creating…" spinner
 * for six minutes. Two other requests that afternoon ran for thirty-six minutes, and
 * ended only because the tab was closed.
 *
 * ## Why it is installed here rather than passed at each call
 *
 * The same reason `neonConfig.fetchFunction` wraps every query on the server: one
 * wrapper cannot be forgotten by code written later, and it reaches things no call site
 * could — route loaders included, which is most of what stalled on 9 Aug.
 *
 * The cost is action at a distance: a call site no longer shows its own deadline. That
 * is the trade this file is making, deliberately.
 *
 * ## Why not `createStart({ serverFns: { fetch } })`
 *
 * Start offers exactly that hook, and it would be tidier — no global to patch, and it
 * is inert during SSR by construction. But it only sees **server functions**, and the
 * longest hang on 9 Aug was `GET /api/auth/get-session`, which BetterAuth's client
 * issues itself: thirty-six minutes, ended by closing the tab. Anything that reaches
 * only half the requests would have left that one exactly as it was.
 *
 * ## What it deliberately does NOT cover
 *
 * A full-page navigation (typing the URL, reloading, following a link into a fresh
 * document) is fetched by the browser itself, with no JavaScript in the loop, so nothing
 * here can bound it. Two of the 9 Aug hangs were exactly that. The server-side query
 * timeout is what covers them.
 */

export const REQUEST_TIMEOUT_MS = 15_000

/**
 * Header a caller can send to ask for a longer deadline than the default.
 *
 * Composition is why this is a header rather than a longer `signal`: the wrapper below
 * merges its deadline with whatever signal the caller passed, and `AbortSignal.any`
 * fires on the *first* to abort — so a caller's generous signal would still be cut short
 * by the default. The header replaces the deadline instead of racing it.
 *
 * It is not stripped before sending. Rebuilding a `Request` to remove one header is a
 * lot of machinery to hide a header we send only to ourselves.
 */
export const TIMEOUT_HEADER = 'x-timeout-ms'

/** `updateProfilePhoto({ data, headers: longerTimeout(60_000) })` */
export function longerTimeout(ms: number): Record<string, string> {
  return { [TIMEOUT_HEADER]: String(ms) }
}

let installed = false

/**
 * Wrap `fetch` so same-origin requests carry a deadline. Client-only — on the server
 * this same global is how the Worker talks to Neon, Companies House and Resend, which
 * have their own bounds and must not inherit a browser's.
 */
export function installRequestTimeout(): void {
  if (installed) return
  installed = true

  const original = globalThis.fetch

  globalThis.fetch = function timedFetch(input, init) {
    if (!isSameOrigin(input)) return original(input, init)

    const deadline = AbortSignal.timeout(requestedTimeout(input, init))
    // The router hands each loader an abort controller so a superseded navigation can
    // be cancelled. Replacing that signal would break navigation; this races the two.
    const caller = init?.signal ?? (input instanceof Request ? input.signal : null)

    return original(input, {
      ...init,
      signal: caller ? anySignal(caller, deadline) : deadline,
    })
  }
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  const href =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  try {
    return new URL(href, globalThis.location?.href).origin === globalThis.location?.origin
  } catch {
    // An unparseable URL is not ours to bound.
    return false
  }
}

function requestedTimeout(input: RequestInfo | URL, init?: RequestInit): number {
  const raw =
    headerOf(init?.headers, TIMEOUT_HEADER) ??
    (input instanceof Request ? input.headers.get(TIMEOUT_HEADER) : null)
  const ms = Number(raw)
  return Number.isFinite(ms) && ms > 0 ? ms : REQUEST_TIMEOUT_MS
}

/** `HeadersInit` is three shapes, and only one of them has `.get()`. */
function headerOf(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  const entries = Array.isArray(headers) ? headers : Object.entries(headers)
  for (const [key, value] of entries) {
    if (key.toLowerCase() === name) return value ?? null
  }
  return null
}

/** `AbortSignal.any` is Chrome 116+ / Safari 17.4+ / Firefox 124+. Older browsers keep
 *  the caller's signal and simply go unbounded, which is where they were before. */
function anySignal(caller: AbortSignal, deadline: AbortSignal): AbortSignal {
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([caller, deadline]) : caller
}
