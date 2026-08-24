// ─── Reporting a fault nobody is waiting on ──────────────────────────────────
//
// Deliberately dependency-free apart from the Sentry SDK. It lives here rather than
// in `errors.ts` because the modules that need it most — `background.ts` and
// `pipelineQueue.ts` — are reachable from route files, and `errors.ts` pulls in
// `./session` (and through it better-auth), which the client bundle is not allowed
// to see. A logger that cannot be imported from the place the failures happen is
// not much of a logger.

import { captureException } from '@sentry/cloudflare'

/**
 * Send a fault to Sentry, and always to the console.
 *
 * The console line is not redundant. `worker-entry.js` is bundled by wrangler while
 * this file is bundled by vite, so the two may hold separate `@sentry/cloudflare`
 * module instances — in which case the client bound by `withSentry` is not the one
 * `captureException` reaches here, and this call quietly does nothing. Workers Logs
 * is enabled in wrangler.toml, so the console line guarantees the failure is
 * recorded somewhere regardless of how that resolves.
 */
export function reportFault(label: string, err: unknown, extra?: Record<string, unknown>): void {
  console.error(`[${label}] failed:`, err, extra ?? '')
  captureFault(err, extra)
}

/**
 * Sentry only, for a caller that has already written its own console line in a
 * format something else greps for — `runInBackground`, whose `[background] <label>
 * failed:` line is named in CLAUDE.md and wrangler.toml as the way to find a dead
 * pipeline in Workers Logs.
 */
export function captureFault(err: unknown, extra?: Record<string, unknown>): void {
  try {
    captureException(err, extra ? { extra } : undefined)
  } catch {
    // No Sentry client bound (local dev, or the two-instance case above). The caller's
    // console line is the durable record either way.
  }
}
