import { defineConfig } from 'vitest/config'

// Pure unit tests (check logic + orchestrator with stubbed fetchers). No DOM
// or live network needed, so we run in a plain node environment and avoid
// loading the app's vite/router plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // `*.itest.ts` needs a live database and has its own project
    // (`vitest.tenancy.config.ts` / `pnpm test:tenancy`). The include glob above
    // already misses it — `*.test.ts` does not match `*.itest.ts` — but only by one
    // character, so the exclusion is stated rather than relied upon.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.itest.ts'],
    environment: 'node',
  },
})
