/**
 * Bound how long a caller waits for a promise, using a plain timer.
 *
 * ## Why a timer rather than an abort signal
 *
 * `AbortSignal.timeout` has failed to end a hung outbound fetch in three production
 * incidents (9, 17 and 18 Aug 2026). The 18 Aug log settles it, because it contains a
 * control: in the same isolate, within the same seconds, a plain `setTimeout` deadline
 * fired five times at exactly 20000ms, while a request whose Neon query carried a 4s
 * abort ran for **90.7 seconds** and was cancelled without ever returning. Timers fire
 * here; aborting an in-flight fetch does not. Every bound in this codebase is therefore
 * enforced by a timer, with the abort signal — where one exists — kept alongside as a
 * hint to the runtime rather than as the guarantee.
 *
 * ## What this does NOT do
 *
 * Nothing here cancels the losing work; nothing can. This bounds what the caller waits
 * for, not what the Worker does. Two consequences follow, and both are handled:
 *
 * - The abandoned promise's eventual rejection is swallowed here, so it cannot surface
 *   later as an unhandled rejection charged to some unrelated request.
 * - A write that we stop waiting for may still have committed. Callers must decide what
 *   that means before using this — which is why `db.ts` never retries a write, and why
 *   only GETs are bounded in `start.ts` and the auth route.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  makeError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(makeError()), ms)
  })

  work.catch(() => {})

  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}
