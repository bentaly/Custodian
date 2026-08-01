import * as Sentry from '@sentry/react'
import {
  IGNORED_MESSAGES,
  SENTRY_DSN,
  resolveEnvironment,
  shouldIgnore,
  shouldReport,
} from './sentry'

let started = false

/**
 * Start Sentry in the browser. Idempotent, and a no-op during SSR — the Worker has its
 * own client (see `worker-entry.js`) — and on localhost, where the stack trace is
 * already in your terminal.
 */
export function initSentryClient(): void {
  if (started || typeof window === 'undefined') return
  started = true

  const environment = resolveEnvironment(window.location.hostname)
  if (!shouldReport(environment)) return

  Sentry.init({
    dsn: SENTRY_DSN,
    environment,

    // Errors only, for now. Tracing and Session Replay are both deliberately off:
    // Replay records the DOM of real sessions, which on this app means applicant
    // names, free-text answers about beneficiaries, and the sort codes and account
    // numbers on the Finance screens. That is a privacy surface to take on
    // deliberately, not by default.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Never attach cookies, headers, or user IP automatically. What we *do* want
    // about the user is attached explicitly in `identifyUser` below.
    sendDefaultPii: false,

    ignoreErrors: IGNORED_MESSAGES,

    // Browser and Worker errors share one project, so tag which half threw. Filter the
    // issue stream with `side:browser` / `side:worker`.
    initialScope: { tags: { side: 'browser' } },

    beforeSend(event, hint) {
      if (shouldIgnore(hint?.originalException)) return null
      return scrub(event)
    },
  })
}

/**
 * Strip anything that could carry grant data out of an event before it leaves the
 * browser. Error *messages* are kept — they are the point — but request bodies and
 * query strings are not, since an application's free-text responses can end up in
 * both.
 */
function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    if (event.request.url) event.request.url = event.request.url.split('?')[0]
  }
  return event
}

/**
 * Attach just enough to triage an issue: who hit it, in what role, for which tenant.
 *
 * Deliberately no email and no name. `id` is enough to find the user via Drizzle
 * Studio when it matters, and `clientId` answers the question that actually drives
 * triage — is this one foundation's data or everyone's?
 */
export function identifyUser(user: {
  id: string
  role: string
  clientId: string | null
}): void {
  Sentry.setUser({ id: user.id })
  Sentry.setTags({ role: user.role, clientId: user.clientId ?? 'none' })
}
