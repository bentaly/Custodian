// ─── Post-response background work ───────────────────────────────────────────
//
// On Cloudflare Workers, the invocation is torn down as soon as the fetch handler
// returns its Response — any still-running promise may be cancelled mid-flight.
// `ctx.waitUntil(promise)` is the platform's escape hatch: it keeps the invocation
// alive until the promise settles. worker-entry.js stashes the per-request ctx on
// globalThis (same pattern as __cfEnv). In local dev (Node/vite) there is no ctx
// and no teardown, so the floating promise simply runs to completion.

interface CfExecutionContext {
  waitUntil?: (promise: Promise<unknown>) => void
}

/** Run a task after the response has been sent. Errors are logged, never thrown —
 *  work here must have its own durable failure story (e.g. an ingest row stuck at
 *  `received` is visible in the admin app and reprocessable). */
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const promise = task().catch((err) => {
    console.error(`[background] ${label} failed:`, err)
  })
  const ctx = (globalThis as { __cfCtx?: CfExecutionContext }).__cfCtx
  ctx?.waitUntil?.(promise)
}
