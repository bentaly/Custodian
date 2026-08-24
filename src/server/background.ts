// ─── Post-response background work ───────────────────────────────────────────
//
// On Cloudflare Workers, the invocation is torn down as soon as the fetch handler
// returns its Response — any still-running promise may be cancelled mid-flight.
// `ctx.waitUntil(promise)` is the platform's escape hatch: it keeps the invocation
// alive until the promise settles. worker-entry.js stashes the per-request ctx on
// globalThis (same pattern as __cfEnv). In local dev (Node/vite) there is no ctx
// and no teardown, so the floating promise simply runs to completion.
//
// ## The 30 second ceiling, and why silence was the real bug
//
// `waitUntil` does NOT mean "until it finishes". Cloudflare allows it to extend the
// invocation for at most **30 seconds after the response is sent**, on every plan,
// and then cancels whatever is still running. On 24 Aug 2026 that cancelled an
// ingest pipeline at 30.5s mid-way through its Custodian score.
//
// The damage was not the cancellation, it was what the cancellation looks like from
// in here: workerd ABANDONS the pending promise rather than rejecting it, so the
// `.catch` below never ran. No console line, no Sentry event, no failed status —
// the submission simply stopped, and the only record anywhere was Cloudflare's own
// `waitUntil() tasks did not complete` warning, which says nothing about what died.
//
// So every task now carries its own deadline, set BELOW the platform's, which turns
// a silent cancellation into an ordinary rejection we can report. Work that needs
// longer than this does not belong here at all — see `pipelineQueue.ts`.

import { withDeadline } from './deadline'
import { captureFault } from './faults'

/**
 * How long a background task may run before we give up waiting on it.
 *
 * Under Cloudflare's 30s so the rejection, the log line and Sentry's own flush (an
 * HTTP request in its own right) all happen while the invocation is still alive. A
 * deadline at 29s would fire into a runtime about to be killed and report nothing —
 * which is the state we are trying to leave.
 *
 * It is not a budget to spend: with the score moved onto the queue, everything left
 * here finishes in under ten seconds, so anything approaching this number is already
 * wrong and the point is to hear about it.
 */
const BACKGROUND_DEADLINE_MS = 25_000

/** Run a task after the response has been sent. Errors are logged and reported,
 *  never thrown — work here must have its own durable failure story (e.g. an ingest
 *  row stuck at `received` is visible in the admin app and reprocessable). */
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const ctx = (globalThis as { __cfCtx?: CfExecutionContext }).__cfCtx
  const started = task()
  // The deadline exists because of the Workers teardown, so it only applies where
  // that teardown does. Under `pnpm dev` there is no ctx and no cliff — bounding
  // there would report a perfectly healthy 40-second local run as a failure, which
  // is how a useful alarm becomes one people learn to ignore.
  const bounded = ctx
    ? withDeadline(
        started,
        BACKGROUND_DEADLINE_MS,
        () =>
          new Error(
            `background task "${label}" did not finish within ${BACKGROUND_DEADLINE_MS}ms ` +
              `(Cloudflare cancels waitUntil work at 30s — this task needs a queue, not a deadline)`,
          ),
      )
    : started
  // The console format is load-bearing: `[background] <label> failed:` is what
  // CLAUDE.md and wrangler.toml both name as the line to search Workers Logs for.
  const promise = bounded.catch((err) => {
    console.error(`[background] ${label} failed:`, err)
    captureFault(err, { task: label })
  })
  ctx?.waitUntil?.(promise)
}

interface CfExecutionContext {
  waitUntil?: (promise: Promise<unknown>) => void
}
