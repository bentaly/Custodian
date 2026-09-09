// ─── The portfolio-analysis dispatcher endpoint ──────────────────────────────
//
// An HTTP route rather than logic reached from the `scheduled` handler, for the two
// reasons the finance digest is one: `worker-entry.js` is bundled by wrangler and
// cannot import anything under `src/`, and a cron you cannot trigger by hand is a
// cron you debug once every three hours.
//
// This endpoint DISPATCHES. It takes the census, works out whose portfolio has
// moved, and sends one queue message per client — it does not analyse anything
// itself. Doing the work here would put every tenant's whole-portfolio read and
// model call inside one invocation, past both the 50-subrequest cap and the
// 30-second post-response ceiling.
//
// Three query parameters, all for driving it by hand:
//   ?clientId=…   one foundation only
//   ?force=1      ignore the census and regenerate regardless — without this a
//                 second run against unchanged data does nothing, so there is no
//                 way to see whether a prompt edit improved anything
//   ?dryRun=1     run the analysis INLINE for the named client and return the brief
//                 and the paragraph without writing a row or touching the queue.
//                 Requires ?clientId, because inline is exactly what must not happen
//                 for every tenant at once.

import { createFileRoute } from '@tanstack/react-router'
import { bearerAuthorised, unauthorised } from '../../server/internalAuth'
import { getDb } from '../../server/db'
import { planDispatch } from '../../server/portfolioAnalysis/dispatch'
import { generatePortfolioAnalysis } from '../../server/portfolioAnalysis/generate'
import { enqueueMany, type PipelineMessage } from '../../server/pipelineQueue'

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/cron/portfolio-analysis')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!bearerAuthorised(request, 'CRON_SECRET')) return unauthorised()

        const url = new URL(request.url)
        const onlyClientId = url.searchParams.get('clientId') ?? undefined
        const force = url.searchParams.get('force') === '1'
        const dryRun = url.searchParams.get('dryRun') === '1'

        if (dryRun && !onlyClientId) {
          return json({ error: 'dryRun requires clientId' }, 400)
        }

        // ── Dry run: one client, inline, nothing written ──
        if (dryRun && onlyClientId) {
          const result = await generatePortfolioAnalysis(onlyClientId, {
            force: true,
            dryRun: true,
          })
          return json({ dryRun: true, result }, 200)
        }

        const plan = await planDispatch(getDb(), {
          ...(onlyClientId ? { onlyClientId } : {}),
          ...(force ? { force } : {}),
        })
        const stale = plan.filter((p) => p.stale)

        const messages: PipelineMessage[] = stale.map((p) => ({
          kind: 'portfolio_analysis',
          clientId: p.clientId,
        }))
        // `sendBatch` under the hood: one subrequest for the whole fan-out rather than
        // one per tenant, which is the difference between this scaling and this
        // exhausting its invocation at the fiftieth foundation.
        //
        // The fallback is the local-dev path (no queue binding), where running the
        // analysis in the background is fine — there is no Workers teardown to be
        // cancelled by, which is the whole reason the queue exists in production.
        const dispatched = await enqueueMany(messages, (m) =>
          m.kind === 'portfolio_analysis'
            ? generatePortfolioAnalysis(m.clientId)
            : Promise.resolve(),
        )

        const summary = {
          clients: plan.length,
          stale: stale.length,
          dispatched,
          names: stale.map((p) => p.clientName),
        }

        // Logged as well as returned: when the Cron Trigger is the caller this response
        // goes nowhere, and Workers Logs is the only record of what it decided.
        console.log(
          `[portfolio-analysis] ${summary.stale}/${summary.clients} clients stale → ${dispatched}` +
            (summary.names.length ? `: ${summary.names.join(', ')}` : ''),
        )

        return json(summary, 200)
      },
    },
  },
} as any)
