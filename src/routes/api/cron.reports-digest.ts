// ─── The reports digest endpoint ─────────────────────────────────────────────
//
// An HTTP route for the two reasons the payments digest is one: `worker-entry.js` is
// bundled by wrangler and cannot import anything under `src/`, and a cron you cannot
// trigger by hand is a cron you debug once a week. It is a curl, and `?dryRun=1`
// renders the whole run and returns it without sending a thing.
//
// Its OWN endpoint rather than a second section inside `/api/cron/finance-digest`,
// even though the same Monday trigger drives both. Two runs, two failure surfaces: if
// the payments query dies, the reports email must still go out, and one endpoint would
// make that one 500. It also keeps each curl-able on its own while the other is being
// changed.
//
// Gated by `CRON_SECRET` as a bearer token, the same fail-closed shape as
// `requireAdminToken`: no configured secret means every request is refused.
import { createFileRoute } from '@tanstack/react-router'
import { runReportsDigest } from '../../server/reportsDigest/run'
import { bearerAuthorised, unauthorised } from '../../server/internalAuth'

export const Route = createFileRoute('/api/cron/reports-digest')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!bearerAuthorised(request, 'CRON_SECRET')) return unauthorised()

        const url = new URL(request.url)
        // `dryRun` defaults to FALSE so a wired Cron Trigger sends. It is spelled out on
        // every manual call instead — the safer default would be a cron that silently
        // did nothing every Monday, which is the harder failure to notice.
        const dryRun = url.searchParams.get('dryRun') === '1'
        // NOTE: outside production the run forces this ON regardless. The summary's
        // own `dryRun` is the EFFECTIVE value and is what the response reports.
        const weekOf = url.searchParams.get('weekOf') ?? undefined
        const onlyClientId = url.searchParams.get('clientId') ?? undefined

        const summary = await runReportsDigest({ dryRun, weekOf, onlyClientId })

        // Logged as well as returned: when the Cron Trigger is the caller, this response
        // goes nowhere, and Workers Logs is the only record of what Monday did.
        console.log(
          `[reports-digest] week ${summary.weekOf}${summary.dryRun ? ' (dry run)' : ''}: ` +
            `${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed`,
        )

        return new Response(JSON.stringify(summary, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
} as any)
