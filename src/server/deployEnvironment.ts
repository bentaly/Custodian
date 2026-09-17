// ─── Which deployment is this? ───────────────────────────────────────────────
//
// `SENTRY_ENVIRONMENT` is set per-Worker in `wrangler.toml` ("production" on the
// `custodian` Worker, "staging" on `custodian-staging`) and is unset under `pnpm dev`
// and `wrangler dev`. It is reused here rather than adding a second variable for the
// reason `BETTER_AUTH_URL` is reused for the digest's links: it already exists in both
// Workers, it is already per-environment, and a new variable is one more thing that can
// be forgotten on a Worker and then only be discovered by its absence doing damage.
//
// Both Workers are built from the same commit, so the BUILD cannot tell them apart —
// only the runtime value can.

/**
 * True only on the production Worker.
 *
 * Fails CLOSED, like `CRON_SECRET`: an environment that does not say it is production is
 * not treated as production. That is the right way round, because everything gated on
 * this is a thing that reaches the outside world.
 */
export function isProductionDeployment(): boolean {
  return process.env['SENTRY_ENVIRONMENT'] === 'production'
}

/** What to call this environment in a log line. */
export function deploymentName(): string {
  return process.env['SENTRY_ENVIRONMENT'] ?? 'development'
}
