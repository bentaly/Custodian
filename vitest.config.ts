import { defineConfig } from 'vitest/config'

// Pure unit tests (check logic + orchestrator with stubbed fetchers). No DOM
// or live network needed, so we run in a plain node environment and avoid
// loading the app's vite/router plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
