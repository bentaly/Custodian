import { isNotFound, isRedirect } from '@tanstack/react-router'

/**
 * Sentry wiring shared by the browser bundle and the Worker.
 *
 * The DSN is deliberately committed rather than plumbed through an env var. A DSN is
 * not a secret — it is embedded verbatim in every browser bundle by design, and only
 * grants permission to *write* events into this one project. Treating it as a secret
 * would mean a `VITE_SENTRY_DSN` build-time variable in CI, which fails silently and
 * invisibly when absent (the client simply stops reporting). Committing it removes
 * that failure mode.
 *
 * `SENTRY_AUTH_TOKEN` — used to upload source maps at build time — genuinely IS a
 * secret and lives in GitHub Actions, never here.
 *
 * EU data region (`ingest.de.sentry.io`): the org was created in the EU region, so
 * applicant data that leaks into an error message stays in the EU.
 */
export const SENTRY_DSN =
  'https://99a1bb7960228a135ed95825e59e6297@o4511832040079360.ingest.de.sentry.io/4511832062820432'

export type SentryEnvironment = 'production' | 'staging' | 'development'

/**
 * Which deployment an event came from, resolved from the hostname.
 *
 * Hostname rather than a build-time variable because both Workers are built from the
 * same `master` commit by the same CI job — there is no build-time signal that tells
 * staging from prod. The Worker passes its own hostname in; the browser reads
 * `location`.
 */
export function resolveEnvironment(hostname: string): SentryEnvironment {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'development'
  if (hostname.startsWith('custodian-staging')) return 'staging'
  return 'production'
}

/**
 * Whether to report at all.
 *
 * Local development is excluded: you are already looking at the stack trace in the
 * terminal, and a morning of hot-reloading a half-written component would otherwise
 * spend the month's quota on errors nobody will ever read.
 *
 * Staging is *included*, deliberately — it is the rehearsal environment where a bad
 * migration or a broken ingest pipeline shows up first, and it runs at near-zero
 * volume. Drop it from this list if the prod stream is all you want to see.
 */
export function shouldReport(environment: SentryEnvironment): boolean {
  return environment === 'production' || environment === 'staging'
}

/**
 * TanStack implements `redirect()` and `notFound()` by *throwing* them — every
 * sign-in bounce and every guard in `_authenticated.beforeLoad` is a throw. They are
 * control flow, not failures, and unfiltered they would exhaust the 5k/month free
 * quota within days while burying anything real.
 */
export function isRouterControlFlow(err: unknown): boolean {
  return isRedirect(err) || isNotFound(err)
}

/**
 * Expected, already-handled application errors: a 404 for a bad id, a 403 for a
 * cross-tenant fetch, a 401 for an expired session. These are the app working
 * correctly and are surfaced to the user by the error boundaries. Only unexpected
 * failures (5xx and anything untyped) are worth an alert.
 *
 * Reads `status` structurally rather than via `instanceof AppError` so this stays
 * usable from the Worker bundle, where the error has crossed a serialisation boundary
 * and lost its prototype.
 */
export function isExpectedAppError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const status = (err as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500
}

/** Everything Sentry should quietly drop, in one predicate. */
export function shouldIgnore(err: unknown): boolean {
  return isRouterControlFlow(err) || isExpectedAppError(err)
}

/**
 * Browser noise that says nothing about our code: extension injections, aborted
 * navigations, and the two ResizeObserver warnings Chrome and Firefox emit under
 * normal use.
 */
export const IGNORED_MESSAGES = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'Non-Error promise rejection captured',
  'AbortError',
  'Load failed',
  'NetworkError when attempting to fetch resource',
]
