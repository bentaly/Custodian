import { createMiddleware, createStart } from '@tanstack/react-start'
import { toClientError } from './server/errors'

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
 * `src/server/db.ts` already aborts each query at 4s via `AbortSignal.timeout`. On
 * 17 Aug that bound demonstrably did not fire — 45 seconds of wall clock, no
 * `DatabaseTimeout` in Sentry, no `[db] slow query` line, and Neon awake throughout —
 * so the Worker was parked on an outbound fetch whose abort never arrived. This races
 * the whole function against a plain timer instead, on the theory that a different
 * mechanism may survive whatever swallowed the first. If the two disagree we will see
 * it, because the deadline logs distinctly when it wins.
 *
 * **Reads only.** A write we abandon may still have committed, which is the exact
 * hazard `couldWrite` in `db.ts` exists to avoid; telling a caller "timed out" about a
 * write that landed is worse than leaving them waiting. GET server functions carry no
 * such risk, and every hang seen so far has been a GET.
 */
const READ_DEADLINE_MS = 20_000

class ServerFnDeadline extends Error {
  override name = 'ServerFnDeadline'
}

/**
 * Sits OUTSIDE `errorMiddleware` in the chain, so the elapsed time it reports covers
 * error handling too and the name it logs is attached to whatever `toClientError`
 * eventually returned.
 */
const observeServerFn = createMiddleware({ type: 'function' }).server(
  async ({ next, method, serverFnMeta }) => {
    const label = serverFnMeta.name || serverFnMeta.filename || 'unknown'
    const startedAt = Date.now()
    console.log(`[fn] → ${label} (${method})`)

    try {
      const result = method === 'GET' ? await withDeadline(next(), label) : await next()
      const elapsed = Date.now() - startedAt
      if (elapsed >= SLOW_FN_MS) console.warn(`[fn] ← ${label} ${elapsed}ms`)
      return result
    } catch (error) {
      console.warn(`[fn] ✕ ${label} ${Date.now() - startedAt}ms: ${describe(error)}`)
      throw error
    }
  },
)

/**
 * Race a promise against a timer. The losing work is NOT cancelled — nothing here can
 * cancel it — so this bounds what the caller waits for, not what the Worker does. That
 * is the honest limit of the approach, and the reason the deadline is generous.
 */
async function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      console.error(`[fn] ⏱ ${label} exceeded ${READ_DEADLINE_MS}ms — abandoning the wait`)
      reject(new ServerFnDeadline(`${label} did not answer within ${READ_DEADLINE_MS}ms`))
    }, READ_DEADLINE_MS)
  })

  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Short and safe: never the message, which can carry SQL or an applicant's answers. */
function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return typeof error
  const named = error as { name?: unknown; status?: unknown }
  const name = typeof named.name === 'string' ? named.name : 'Error'
  return typeof named.status === 'number' ? `${name} (${named.status})` : name
}

/**
 * Start's global configuration entry, discovered by filename (`src/start.ts`).
 *
 * Order matters: middleware runs outside-in, so `observeServerFn` wraps
 * `errorMiddleware` and therefore times and names every call including its failures.
 */
export const startInstance = createStart(() => ({
  functionMiddleware: [observeServerFn, errorMiddleware],
}))
