// ─── The new-awards endpoint ─────────────────────────────────────────────────
//
// An HTTP route for the two reasons every other cron here is one: `worker-entry.js` is
// bundled by wrangler and cannot import anything under `src/`, and a cron you cannot
// drive by hand is a cron you debug four times a day. `?dryRun=1` assembles every email
// and returns who would get what, without sending or writing a receipt.
//
// Its own endpoint rather than a branch inside `/api/cron/portfolio-analysis`, although
// the same trigger drives both: a census that dies on one tenant must not swallow the
// award notifications queued behind it, and each stays curl-able while the other is
// being changed.
//
// **It DISPATCHES.** One query finds the pending work for every tenant at once, and then
// each client gets its own queue message and its own invocation. Sending inline would be
// simpler and is what this was first written as - and it breaks on the 50-subrequest cap
// the moment the platform has real tenants, because every Resend call and every receipt
// insert is a subrequest and they all land in ONE invocation. This way the tick costs
// two subrequests (the query, then one `sendBatch`) however many foundations there are.
//
// Three parameters, all for driving it by hand:
//   ?clientId=…     one foundation only
//   ?dryRun=1       assemble and report, send nothing, write nothing
//   ?windowDays=…   widen or narrow the "how new is new" bound, which is the only way to
//                   rehearse a backfill without waiting a week for one
//
// Gated by `CRON_SECRET` as a bearer token, the same fail-closed shape as the digests.
import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import { runAwardNotifications } from '../../server/awardNotifications/run'
import { pendingAwardNotifications } from '../../server/awardNotifications/query'
import { wantsAwardNotifications } from '../../lib/awardNotifications/optIn'
import { enqueueMany, type PipelineMessage } from '../../server/pipelineQueue'
import { bearerAuthorised, unauthorised } from '../../server/internalAuth'

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/cron/award-notifications')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!bearerAuthorised(request, 'CRON_SECRET')) return unauthorised()

        const url = new URL(request.url)
        // Defaults to FALSE so a wired trigger sends; outside production the run forces
        // it on regardless, and the summary's own `dryRun` is the effective value.
        const dryRun = url.searchParams.get('dryRun') === '1'
        const onlyClientId = url.searchParams.get('clientId') ?? undefined
        const raw = url.searchParams.get('windowDays')
        const parsed = raw === null ? Number.NaN : Number(raw)
        const windowDays = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined

        // A dry run answers INLINE and returns who would get what. That is the whole
        // point of the mode - a dispatch that queued the work would report only that it
        // had queued it, which is not something you can read.
        if (dryRun) {
          const summary = await runAwardNotifications({ dryRun: true, onlyClientId, windowDays })
          console.log(
            `[award-notifications] (dry run): ${summary.pending} pending, ` +
              `${summary.outcomes.length} would be emailed`,
          )
          return json(summary, 200)
        }

        // Which foundations have anything to say. The opt-in rule is applied HERE too,
        // via the same predicate the run uses, so a client whose only admin has switched
        // the email off never gets a message queued for it at all.
        const pending = await pendingAwardNotifications(getDb(), { onlyClientId, windowDays })
        const clientIds = [
          ...new Set(pending.filter(wantsAwardNotifications).map((p) => p.clientId)),
        ]

        const messages: PipelineMessage[] = clientIds.map((clientId) => ({
          kind: 'award_notification',
          clientId,
        }))

        // The fallback is the local-dev path (no queue binding), where running it in the
        // background is fine - there is no Workers teardown to be cancelled by, which is
        // the whole reason the queue exists in production.
        const dispatched = await enqueueMany(messages, (m) =>
          m.kind === 'award_notification'
            ? runAwardNotifications({ onlyClientId: m.clientId })
            : Promise.resolve(),
        )

        const summary = {
          pendingPairs: pending.length,
          clients: clientIds.length,
          dispatched,
        }

        // Logged as well as returned: when the trigger is the caller this response goes
        // nowhere, and Workers Logs is the only record of what the tick did.
        console.log(
          `[award-notifications] ${summary.pendingPairs} pending pairs across ` +
            `${summary.clients} client(s) → ${dispatched}`,
        )

        return json(summary, 200)
      },
    },
  },
} as any)
