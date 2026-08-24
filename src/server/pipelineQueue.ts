// ─── The pipeline queue ──────────────────────────────────────────────────────
//
// Post-response work used to run under `ctx.waitUntil`, which Cloudflare allows to
// continue for at most **30 seconds after the response is sent** — on every plan.
// The ingest pipeline's promote path is 35-60s (the Custodian score alone is
// 30-58s of model time), so it was living on the wrong side of a hard limit: on
// 24 Aug 2026 a submission's invocation was cancelled at exactly 30.5s, and
// because a cancelled `waitUntil` promise is ABANDONED rather than rejected,
// nothing threw, nothing logged, and Sentry saw nothing. The row simply stopped.
//
// A queue consumer gets 15 minutes instead, plus retries with backoff and a
// dead-letter queue for whatever still fails. That is the whole reason this exists.
//
// Degrades the same way `rateLimit.ts` does: with no binding (local `pnpm dev`, or
// before the queue is provisioned) the work falls back to `runInBackground`, which
// is exactly today's behaviour — correct for local dev, where there is no Workers
// teardown at all, and no worse than the status quo anywhere else.

import { runInBackground } from './background'
import { reportFault } from './faults'

/** A unit of pipeline work. Kept deliberately small — an id and a verb, never a
 *  payload. The row is already in the database; re-reading it means a retry always
 *  acts on current state rather than on a snapshot taken minutes ago. */
export type PipelineMessage =
  | { kind: 'ingest'; ingestId: string }
  | { kind: 'report_ingest'; ingestId: string }
  | { kind: 'score'; applicationId: string }

interface QueueBinding {
  send(body: unknown): Promise<void>
}

function getQueue(): QueueBinding | null {
  const env = (globalThis as { __cfEnv?: Record<string, unknown> }).__cfEnv
  const binding = env?.['PIPELINE_QUEUE']
  if (binding && typeof (binding as QueueBinding).send === 'function') {
    return binding as QueueBinding
  }
  return null
}

/**
 * Hand a unit of work to the queue, falling back to in-invocation background work.
 *
 * Returns how it was dispatched, so the caller can say so. A `send` that throws is
 * reported rather than swallowed: it is the ONE gap the queue cannot cover itself,
 * because a queue can retry a message it has and not one it never received. The
 * ingest row is already committed at this point, so a failure here costs promptness
 * (the row waits in the admin queue as `pipeline_stalled`) and never the submission.
 */
export async function enqueue(
  message: PipelineMessage,
  fallback: () => Promise<unknown>,
): Promise<'queued' | 'background' | 'failed'> {
  const queue = getQueue()
  if (!queue) {
    runInBackground(`${message.kind} (no queue binding)`, fallback)
    return 'background'
  }
  try {
    await queue.send(message)
    return 'queued'
  } catch (err) {
    // Do NOT fall back to runInBackground here. The reason we are on a queue is
    // that this work does not fit in the budget runInBackground has, so "try it
    // inline instead" would reproduce the exact failure this replaced — only now
    // with a log line claiming the queue was used.
    reportFault('queue', err, { message })
    return 'failed'
  }
}
