import { defineConfig } from 'vitest/config'

// The tenancy suite, kept apart from `pnpm test` because it is the one suite that
// needs a real database. `vitest.config.ts` is documented as offline — no DOM, no
// network — and CI runs it unconditionally on every push and PR, including from forks
// where no secret is available. Mixing a connection-dependent test into it would make
// that job fail for anyone without one.
//
// `fileParallelism: false` because the fixture writes real rows: two runs against the
// same branch at once would still pass (every assertion is scoped to markers minted
// per run) but there is no reason to pay for the contention.
//
// The timeouts are for Neon's cold start — autosuspend is fixed at 5 minutes on the
// Free plan and cannot be disabled, so the first query of a run routinely waits
// several seconds for the compute to wake.
export default defineConfig({
  test: {
    include: ['src/**/*.itest.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
