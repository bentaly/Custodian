// ─── The queue consumer's door into the app ──────────────────────────────────
//
// `worker-entry.js` receives queue messages, but it is bundled by wrangler and
// cannot import anything under `src/` — the same constraint the Cron Trigger hit.
// So it does what the cron does: calls `handler.fetch()` with a synthetic Request
// aimed at this route. That call is in-process — no network hop, no subrequest.
//
// Gated by `CRON_SECRET` rather than a new secret of its own. It is the same kind
// of thing (the platform triggering our own work, with no user session), it is
// already set on both Workers, and a second secret is a second thing to forget to
// set — which for a fail-closed gate means a queue that silently 401s forever.

import { createFileRoute } from '@tanstack/react-router'
import { bearerAuthorised, unauthorised } from '../../server/internalAuth'
import { processIngest } from '../../server/fieldMapping/ingest'
import { processReportIngest } from '../../server/reportMapping/ingest'
import { scoreApplication } from '../../server/applications/score'
import type { PipelineMessage } from '../../server/pipelineQueue'

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Run one unit of pipeline work.
 *
 * The status code IS the retry decision: `worker-entry.js` retries the message on
 * anything that is not 2xx. So the rule here is that a 5xx must mean "try again and
 * it might work" — a message this Worker will never be able to process (an ingest
 * that has already moved on, an application already scored) answers 200, because
 * retrying it three times and then parking it in the dead-letter queue would fill
 * that queue with work that was never actually lost.
 */
export const Route = createFileRoute('/api/internal/pipeline')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!bearerAuthorised(request, 'CRON_SECRET')) return unauthorised()

        let message: PipelineMessage
        try {
          message = (await request.json()) as PipelineMessage
        } catch {
          return json({ error: 'Body must be a pipeline message' }, 400)
        }

        try {
          switch (message.kind) {
            case 'ingest': {
              const result = await processIngest(message.ingestId)
              // `not_received` means someone else finished it (a Reprocess, an earlier
              // delivery of this same message). Done is done — do not retry.
              return json({ ok: true, result }, 200)
            }
            case 'report_ingest': {
              const result = await processReportIngest(message.ingestId)
              return json({ ok: true, result }, 200)
            }
            case 'score': {
              const result = await scoreApplication(message.applicationId)
              return json({ ok: true, result }, 200)
            }
            default:
              return json({ error: 'Unknown message kind' }, 400)
          }
        } catch (err) {
          // A thrown error here is the retryable case — a database timeout, most
          // likely. The pipeline's own failures (a model error, an unmappable
          // payload) never throw: they land on the row as a status.
          console.error(`[pipeline] ${message.kind} failed:`, err)
          return json({ error: err instanceof Error ? err.message : 'Pipeline failed' }, 500)
        }
      },
    },
  },
} as any)
