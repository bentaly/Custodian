import { captureException } from '@sentry/cloudflare'
import { AppError, isAppError, statusOf } from '../lib/errors'
import { isRouterControlFlow } from '../lib/sentry'
import { databaseTimeout } from './db'
import { getAuthUser } from './session'

/**
 * Turn whatever a server function threw into what the caller is allowed to see.
 *
 * The redaction happens **here, on the server** rather than in the UI. That is the
 * point: a non-superadmin never receives the stack at all, instead of receiving it and
 * having the client politely decline to render it. Anyone can read a response body.
 *
 * This also closes a leak that predates the feature. TanStack serialises thrown server
 * errors with seroval, which copies an Error's own properties — including `stack` — at
 * its default feature flags. Every unhandled server error was already shipping its
 * stack trace to every user in production. Everything below rebuilds the error from
 * scratch rather than mutating it, so nothing rides along by accident.
 */
export async function toClientError(err: unknown): Promise<unknown> {
  // `redirect()` and `notFound()` are how TanStack expresses control flow. They must
  // pass through untouched or navigation breaks.
  if (isRouterControlFlow(err)) return err

  const status = statusOf(err)

  // Expected, already-meaningful failures: a 404 for a bad id, a 403 across tenants.
  // The message was written for the user, so keep it — but still rebuild the error so
  // no stack rides along.
  if (isAppError(err) && status >= 400 && status < 500) {
    return clientError(status, (err as Error).message)
  }

  // A database timeout is a fault — it belongs in Sentry — but unlike the rest of the
  // 5xx family its message is written for the user and says what to do next, so it is
  // kept rather than replaced with the generic copy. Read and write are told apart
  // because only one of them leaves a question about what happened: a write that timed
  // out may still have committed (see `databaseTimeout`).
  // We stopped waiting rather than the database refusing — see `src/start.ts`. Same
  // shape of answer as a read that timed out, and deliberately the same copy, because
  // it is the same question for the user: nothing happened, try again. Handled here
  // rather than in the middleware that throws it so that a deadline is redacted and
  // reported exactly like every other server fault, instead of being the one error
  // that reaches the browser with its stack attached.
  if (isServerFnDeadline(err)) {
    reportServerError(err)
    return clientError(503, 'The server did not respond in time. Please try again.')
  }

  const timeout = databaseTimeout(err)
  if (timeout) {
    reportServerError(err)
    return clientError(
      503,
      timeout.isWrite
        ? 'Timed out — refresh to check whether this saved.'
        : 'The database did not respond in time. Please try again.',
    )
  }

  // Anything else is a fault. Report it, then decide how much to hand back.
  reportServerError(err)

  const trace = (await callerMaySeeTrace()) ? formatTrace(err) : null

  return clientError(500, 'Something went wrong at our end. Please try again.', trace)
}

/**
 * Only platform superadmins get a trace. Resolved from the session rather than
 * anything in the request, so it cannot be spoofed by the caller.
 *
 * A failure here (the error being an auth failure in the first place, or the database
 * being the thing that broke) means no trace, which is the safe direction.
 */
async function callerMaySeeTrace(): Promise<boolean> {
  try {
    const user = await getAuthUser()
    return user?.role === 'superadmin'
  } catch {
    return false
  }
}

/** Message, stack, and any `cause` chain, flattened for display in a <details>. */
function formatTrace(err: unknown): string {
  const parts: string[] = []
  let current: unknown = err
  let depth = 0

  while (current && depth < 5) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}\n${current.stack ?? '(no stack)'}`)
      current = (current as { cause?: unknown }).cause
    } else {
      parts.push(String(current))
      current = undefined
    }
    depth++
    if (current) parts.push('\nCaused by:\n')
  }

  return parts.join('\n')
}

/**
 * Build the error the client receives. Deliberately a fresh `Error` with an explicitly
 * blanked stack — the local one would describe this file, which tells the user nothing
 * and leaks our layout.
 */
function clientError(status: number, message: string, serverStack?: string | null) {
  const err = new Error(message)
  err.name = 'AppError'
  err.stack = ''
  Object.assign(err, { status, isAppError: true })
  if (serverStack) Object.assign(err, { serverStack })
  return err
}

/**
 * Send a fault to Sentry, and always to the console.
 *
 * The console line is not redundant. `worker-entry.js` is bundled by wrangler while
 * this file is bundled by vite, so the two may hold separate `@sentry/cloudflare`
 * module instances — in which case the client bound by `withSentry` is not the one
 * `captureException` reaches here, and this call quietly does nothing. Workers Logs is
 * already enabled in wrangler.toml, so the console line guarantees the failure is
 * recorded somewhere regardless of how that resolves.
 */
function reportServerError(err: unknown): void {
  console.error('[server-fn] unhandled error:', err)
  try {
    captureException(err)
  } catch {
    // No Sentry client bound (local dev, or the two-instance case above). The console
    // line above is the durable record either way.
  }
}

const FN_DEADLINE = 'ServerFnDeadline' as const

/**
 * Thrown when a read exceeded the last-resort bound in `src/start.ts`.
 *
 * Lives here, not there, so `toClientError` can recognise it without importing from
 * the middleware that imports `toClientError`.
 */
export function serverFnDeadline(label: string, ms: number): Error {
  const error = new Error(`${label} did not answer within ${ms}ms`)
  error.name = FN_DEADLINE
  return error
}

export function isServerFnDeadline(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === FN_DEADLINE
}

/** Re-exported so server code has one import for throwing and shaping errors. */
export { AppError }
