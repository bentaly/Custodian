/**
 * Typed application errors, shared by the server functions that throw them and the
 * boundaries that render them.
 *
 * ## Why not `instanceof`
 *
 * A server function's error is serialised and re-thrown on the client, losing its
 * prototype chain on the way — `err instanceof AppError` is always false there. Every
 * predicate below is therefore structural. This is the whole reason the type exists:
 * before it, the client could only tell a 404 from a 403 by matching on message text.
 *
 * ## Why an own property is not enough on its own
 *
 * Being a plain own property is NOT sufficient for `status` to reach the browser,
 * which is what this file claimed until 25 Aug 2026. TanStack registers its own
 * `ShallowErrorPlugin` for anything `instanceof Error`, and that plugin keeps the
 * message and **nothing else** — deliberately, so an error carrying unserialisable
 * junk (a ZodError's functions) cannot break the response.
 *
 * So every server-function error arrived as a bare `Error`: no `status`, no
 * `isAppError`, no `serverStack`. Silently, and for as long as the app has existed.
 * `statusOf` read 500 for a 403; `messageFor` replaced every written 4xx message with
 * "Something went wrong at our end"; `shouldIgnore` stopped recognising an expected
 * error and let all of them through to Sentry; the superadmin trace never rendered.
 *
 * `appErrorSerialization` at the foot of this file is what actually makes the crossing
 * work. It is registered on `serializationAdapters` in `src/start.ts`, where custom
 * adapters are tried BEFORE the built-in plugins.
 */

import { createSerializationAdapter } from '@tanstack/react-router'

export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 500

export class AppError extends Error {
  /** HTTP-shaped status. 4xx is expected and shown to the user; 5xx is a fault. */
  readonly status: AppErrorStatus
  /** Structural marker, read in place of `instanceof`. It reaches the browser only
   *  because `appErrorSerialization` below carries it there. */
  readonly isAppError = true

  constructor(status: AppErrorStatus, message: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
  }
}

export const badRequest = (message = 'That request was not valid.') => new AppError(400, message)
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, message)
export const forbidden = (message = 'You do not have access to that.') => new AppError(403, message)
export const notFoundError = (message = 'We could not find that.') => new AppError(404, message)
export const conflict = (message: string) => new AppError(409, message)

/** True for anything carrying our status marker, on either side of the wire. */
export function isAppError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { isAppError?: unknown }).isAppError === true
  )
}

/** The status of any thrown value; anything untyped counts as a 500. */
export function statusOf(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return 500
}

/**
 * The server stack, but only when the server chose to send it — it is attached for
 * superadmins and stripped for everyone else (see `src/server/errors.ts`). The client
 * never decides who may see a trace; it just renders what it was given.
 */
export function serverStackOf(err: unknown): string | null {
  if (typeof err === 'object' && err !== null) {
    const trace = (err as { serverStack?: unknown }).serverStack
    if (typeof trace === 'string' && trace.length > 0) return trace
  }
  return null
}

/**
 * A request that was cut short rather than answered — our own client-side deadline
 * (`requestTimeout`), or the user navigating away mid-flight. The two are
 * indistinguishable from here and the advice is the same either way: nobody knows
 * whether the server acted, so look before acting again.
 */
export function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { name?: unknown }).name === 'TimeoutError' ||
      (err as { name?: unknown }).name === 'AbortError')
  )
}

/**
 * The three messages a browser gives when a `fetch` never happened at all — no
 * response, no status, nothing for the server to have logged. Chrome, Safari and
 * Firefox each word it differently, and Firefox's ends in a full stop.
 *
 * Matched EXACTLY rather than as a substring, which is the whole subtlety here:
 * Chrome also says "Failed to fetch dynamically imported module: …" when a chunk has
 * gone missing after a deploy. That is a stale build, not a dropped connection, it is
 * recovered by `lib/staleChunk`, and telling the user to check their wifi would send
 * them looking in the wrong place.
 */
const NETWORK_MESSAGES = new Set([
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource',
])

/**
 * The connection dropped, rather than the server failing.
 *
 * Worth separating from a 500 because the advice is the opposite: nothing on our side
 * went wrong, nobody was alerted, and retrying is genuinely likely to work once the
 * user is back online. Untreated, these land on the generic fault copy and tell a
 * foundation the app is broken when their laptop had simply gone to sleep.
 *
 * Reads `name` structurally rather than `instanceof TypeError`, matching `isAbort`
 * above: the same predicate has to hold for an error that has lost its prototype.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if ((err as { name?: unknown }).name !== 'TypeError') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && NETWORK_MESSAGES.has(message.replace(/\.$/, ''))
}

/**
 * User-facing copy. An `AppError`'s own message is written for the user and is used
 * verbatim; anything else is an unhandled fault whose message could contain a SQL
 * fragment or an API key, so it is replaced wholesale.
 */
export function messageFor(err: unknown): string {
  if (isAppError(err) && err instanceof Error && err.message) return err.message
  // A DOMException's own text ("signal is aborted without reason") tells the user
  // nothing they can act on.
  if (isAbort(err)) return 'Timed out — refresh to check whether this saved.'
  if (isNetworkError(err)) return "Couldn't reach the server — check your connection and try again."
  const status = statusOf(err)
  if (status >= 400 && status < 500 && err instanceof Error && err.message) {
    return err.message
  }
  return 'Something went wrong at our end. Please try again.'
}

// ─── Crossing the wire ───────────────────────────────────────────────────────

/**
 * What an `AppError` is once it has crossed: our own properties hanging off a plain
 * `Error`, with no prototype chain and no stack.
 *
 * `status` is a plain `number`, not `AppErrorStatus` — `toClientError` also sends 503
 * for a timeout, which is not a status anything throws directly.
 */
export type WireAppError = Error & {
  status: number
  isAppError: true
  serverStack?: string
}

/**
 * Keeps an `AppError` intact between the Worker and the browser.
 *
 * Registered on `serializationAdapters` in `src/start.ts`, which is the whole fix:
 * custom adapters are tried ahead of the built-in plugins, so ours claims the error
 * before `ShallowErrorPlugin` can reduce it to its message (see the note at the top of
 * this file for what that cost).
 *
 * It **rebuilds** rather than copying, for the same reason `clientError` does in
 * `src/server/errors.ts`: only the three properties named here cross, so this cannot
 * become a second route by which a server stack reaches a user who may not see one.
 * That decision stays on the server, which attaches `serverStack` when the answer is
 * yes and omits it otherwise.
 */
export const appErrorSerialization = createSerializationAdapter({
  key: 'custodian/AppError',
  test: (value: unknown): value is WireAppError => isAppError(value) && value instanceof Error,
  toSerializable: (err: WireAppError) => ({
    status: err.status,
    message: err.message,
    serverStack: err.serverStack,
  }),
  fromSerializable: (wire: { status: number; message: string; serverStack?: string }) => {
    const err = new Error(wire.message) as WireAppError
    err.name = 'AppError'
    err.stack = ''
    err.status = wire.status
    err.isAppError = true
    if (wire.serverStack) err.serverStack = wire.serverStack
    return err
  },
})
