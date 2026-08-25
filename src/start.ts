import { createMiddleware, createStart } from '@tanstack/react-start'
import { withDeadline } from './server/deadline'
import { isServerFnDeadline, serverFnDeadline, toClientError } from './server/errors'
import { appErrorSerialization, statusOf } from './lib/errors'
import { signInPath } from './lib/signInRedirect'

/**
 * Runs around every server function, so error handling cannot be forgotten at a call
 * site. There are ~40 throw sites across `src/server/fns/`; wrapping each one by hand
 * would guarantee that the one added next month is the one that leaks a stack trace.
 *
 * `toClientError` decides what the caller may see — see that file for the reasoning.
 */
const errorMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next()
  } catch (err) {
    throw await toClientError(err)
  }
})

/**
 * How long a server function may run before a completed call is worth a log line.
 *
 * The *entry* line below is the load-bearing one, though. On 17 Aug 2026 two `getMe`
 * invocations ran for 60.4s and 45.4s and returned nothing — `outcome: canceled`,
 * `cpuTimeMs: 1`. Reconstructing that took a Sentry event, a Neon operations log and a
 * hand-read of Cloudflare's raw JSON, and even then the request could only be
 * identified by grepping `dist/` for the server-fn hash: Workers Logs redacts the
 * 64-hex id out of the URL as if it were a secret, so the path reads
 * `/_serverFn/REDACTED` and cannot be searched or filtered on.
 *
 * An "after" line can never record a hang, because a hang never reaches the after. One
 * line on entry costs one log per invocation and turns an unsearchable hash into a
 * name; an entry with no matching exit, read next to Cloudflare's own `wallTimeMs`, is
 * a hang stated rather than inferred.
 */
const SLOW_FN_MS = 1_000

/**
 * A last-resort bound on a read, well above anything legitimate.
 *
 * `src/server/db.ts` bounds each query at 4s. On 17 Aug that bound demonstrably did not
 * fire — 45 seconds of wall clock, no `DatabaseTimeout` in Sentry, no `[db] slow query`
 * line, and Neon awake throughout — so the Worker was parked on an outbound fetch whose
 * abort never arrived. This races the whole function against a plain timer instead, on
 * the theory that a different mechanism may survive whatever swallowed the first.
 *
 * It does. On 18 Aug this deadline fired five times, exactly on schedule, against the
 * same hang — which is what moved `db.ts` off `AbortSignal.timeout` and onto the same
 * timer. This stays as the outer backstop: it covers a server function that hangs
 * somewhere other than a query.
 *
 * **Reads only.** A write we abandon may still have committed, which is the exact
 * hazard `couldWrite` in `db.ts` exists to avoid; telling a caller "timed out" about a
 * write that landed is worse than leaving them waiting. GET server functions carry no
 * such risk, and every hang seen so far has been a GET.
 *
 * **It must stay BELOW `REQUEST_TIMEOUT_MS` (15s, the browser's own bound.)** At 20s it
 * was above it, and the 18 Aug incident shows what that cost: the browser gave up at
 * 15s with a bare `TimeoutError` five seconds before the server produced its careful
 * "did not respond in time" 503, so the user never saw the good message and Sentry
 * logged the same event twice from both ends. A bound the other end never waits for is
 * not a bound. 12s keeps ~30x headroom over the slowest GET actually observed (420ms).
 */
const READ_DEADLINE_MS = 12_000

/**
 * Sits OUTSIDE `errorMiddleware` in the chain, so the elapsed time it reports covers
 * error handling too and the name it logs is attached to whatever `toClientError`
 * eventually returned.
 *
 * That ordering has one consequence to keep in mind: an error thrown by THIS middleware
 * has not passed through `toClientError`, so it would reach the browser with its stack
 * intact and never reach Sentry. Only the deadline can do that, so only the deadline is
 * converted on the way out.
 */
const observeServerFn = createMiddleware({ type: 'function' }).server(
  async ({ next, method, serverFnMeta }) => {
    const label = serverFnMeta.name || serverFnMeta.filename || 'unknown'
    const startedAt = Date.now()
    console.log(`[fn] → ${label} (${method})`)

    try {
      const result = method === 'GET' ? await readWithinDeadline(next(), label) : await next()
      const elapsed = Date.now() - startedAt
      if (elapsed >= SLOW_FN_MS) console.warn(`[fn] ← ${label} ${elapsed}ms`)
      return result
    } catch (error) {
      console.warn(`[fn] ✕ ${label} ${Date.now() - startedAt}ms: ${describe(error)}`)
      throw isServerFnDeadline(error) ? await toClientError(error) : error
    }
  },
)

/** The read bound, with the log line that names which function hit it. */
function readWithinDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  return withDeadline(work, READ_DEADLINE_MS, () => {
    console.error(`[fn] ⏱ ${label} exceeded ${READ_DEADLINE_MS}ms — abandoning the wait`)
    return serverFnDeadline(label, READ_DEADLINE_MS)
  })
}

/** Short and safe: never the message, which can carry SQL or an applicant's answers. */
function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return typeof error
  const named = error as { name?: unknown; status?: unknown }
  const name = typeof named.name === 'string' ? named.name : 'Error'
  return typeof named.status === 'number' ? `${name} (${named.status})` : name
}

/**
 * What happens in the browser when the server says 401.
 *
 * `_authenticated.beforeLoad` is the app's only auth redirect, and it runs on
 * NAVIGATION. A server function called from inside a component — a comments panel
 * loading, a vote being cast — never passes it, so an expired session had nowhere to
 * go: it surfaced as a rejected promise nobody was catching. On 25 Aug 2026 that was
 * an unhandled rejection in Sentry (`Please sign in to continue.`, from
 * `CommentsSection`) and a panel that sat on "Loading…" for as long as the tab stayed
 * open. The user was signed out and the app never said so.
 *
 * It reaches the page at all because `currentUser` caches the guard's answer for five
 * minutes, so `beforeLoad` can wave someone through on a session the server has
 * already stopped honouring. That cache is deliberate (see `src/lib/currentUser.ts`);
 * this is the other half of it.
 *
 * A **client** middleware, because the server already knows what it said — the caller
 * is the half that has to act. And a hard navigation rather than `router.navigate`:
 * the router would keep every cached loader result and that five-minute identity,
 * which is the stale state that produced the problem. A reload clears all of it.
 *
 * The page being left is handed to /sign-in as `?redirect=`, so signing back in
 * returns the user to the application they were reading rather than the dashboard —
 * see `src/lib/signInRedirect.ts`, which is also what vets the value.
 *
 * The error is still re-thrown. The call must not resolve with `undefined` while the
 * browser is on its way out, and Sentry now drops it on the way past — `shouldIgnore`
 * can finally read the 401, thanks to `appErrorSerialization`.
 */
const unauthorizedRedirect = createMiddleware({ type: 'function' }).client(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    // `typeof window` excludes SSR, where there is no page to send anywhere. The
    // pathname check excludes /sign-in itself, which would reload in a loop.
    if (statusOf(error) === 401 && typeof window !== 'undefined') {
      const { pathname, search } = window.location
      if (pathname !== '/sign-in') window.location.href = signInPath(pathname + search)
    }
    throw error
  }
})

/**
 * Start's global configuration entry, discovered by filename (`src/start.ts`).
 *
 * Order matters: middleware runs outside-in, so `observeServerFn` wraps
 * `errorMiddleware` and therefore times and names every call including its failures.
 * `unauthorizedRedirect` is outermost of the three, which is what puts it on the far
 * side of the wire from the other two — it sees the error the browser was actually
 * handed, after `appErrorSerialization` has rebuilt it.
 */
export const startInstance = createStart(() => ({
  serializationAdapters: [appErrorSerialization],
  functionMiddleware: [unauthorizedRedirect, observeServerFn, errorMiddleware],
}))
