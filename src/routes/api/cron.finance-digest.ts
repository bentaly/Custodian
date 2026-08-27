// ─── The digest endpoint ─────────────────────────────────────────────────────
//
// The Monday run is an HTTP route rather than logic reached directly from a `scheduled`
// handler, for two reasons:
//
//  1. `worker-entry.js` is bundled by wrangler, not vite — it cannot import anything
//     under `src/`. It CAN call `handler.fetch()` with a synthetic Request, which is an
//     ordinary function call: no network hop, no subrequest, no loopback.
//  2. A cron you cannot trigger by hand is a cron you debug once a week. This one is a
//     curl, and `?dryRun=1` renders the whole run and returns it without sending a
//     thing — which is how it is meant to be exercised until we trust it.
//
// Gated by `CRON_SECRET` as a bearer token, the same fail-closed shape as
// `requireAdminToken`: no configured secret means every request is refused, so a Worker
// missing the secret cannot be triggered by anyone.
import { createFileRoute } from '@tanstack/react-router'
import { runFinanceDigest } from '../../server/financeDigest/run'
import { bearerAuthorised, unauthorised } from '../../server/internalAuth'

export const Route = createFileRoute('/api/cron/finance-digest')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!bearerAuthorised(request, 'CRON_SECRET')) return unauthorised()

        const url = new URL(request.url)
        // `dryRun` defaults to FALSE so a wired Cron Trigger sends. It is spelled out on
        // every manual call instead — the safer default would be a cron that silently
        // did nothing every Monday, which is the harder failure to notice.
        const dryRun = url.searchParams.get('dryRun') === '1'
        const weekOf = url.searchParams.get('weekOf') ?? undefined
        const onlyClientId = url.searchParams.get('clientId') ?? undefined

        const summary = await runFinanceDigest({ dryRun, weekOf, onlyClientId })

        // Logged as well as returned: when the Cron Trigger is the caller, this response
        // goes nowhere, and Workers Logs is the only record of what Monday did.
        console.log(
          `[finance-digest] week ${summary.weekOf}${dryRun ? ' (dry run)' : ''}: ` +
            `${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed`,
        )

        return new Response(JSON.stringify({ dryRun, ...summary }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
} as any)
