/**
 * Typed application errors, shared by the server functions that throw them and the
 * boundaries that render them.
 *
 * ## Why not `instanceof`
 *
 * A server function's error is serialised (by seroval) and re-thrown on the client.
 * Seroval copies an Error's own properties but **not** its prototype chain, so what
 * arrives in the browser is a plain `Error` with our fields hanging off it —
 * `err instanceof AppError` is always false there. Every predicate below is therefore
 * structural, and `status` is a plain own property specifically so it survives the
 * crossing. This is the whole reason the type exists: before it, the client could only
 * tell a 404 from a 403 by matching on message text.
 */

export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 500

export class AppError extends Error {
  /** HTTP-shaped status. 4xx is expected and shown to the user; 5xx is a fault. */
  readonly status: AppErrorStatus
  /** Structural marker — survives serialisation where the prototype does not. */
  readonly isAppError = true

  constructor(status: AppErrorStatus, message: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
  }
}

export const badRequest = (message = 'That request was not valid.') =>
  new AppError(400, message)
export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, message)
export const forbidden = (message = 'You do not have access to that.') =>
  new AppError(403, message)
export const notFoundError = (message = 'We could not find that.') =>
  new AppError(404, message)
export const conflict = (message: string) => new AppError(409, message)

/** True for anything carrying our status marker, on either side of the wire. */
export function isAppError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { isAppError?: unknown }).isAppError === true
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
 * User-facing copy. An `AppError`'s own message is written for the user and is used
 * verbatim; anything else is an unhandled fault whose message could contain a SQL
 * fragment or an API key, so it is replaced wholesale.
 */
export function messageFor(err: unknown): string {
  if (isAppError(err) && err instanceof Error && err.message) return err.message
  // A DOMException's own text ("signal is aborted without reason") tells the user
  // nothing they can act on.
  if (isAbort(err)) return 'Timed out — refresh to check whether this saved.'
  const status = statusOf(err)
  if (status >= 400 && status < 500 && err instanceof Error && err.message) {
    return err.message
  }
  return 'Something went wrong at our end. Please try again.'
}
