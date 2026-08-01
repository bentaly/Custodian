import { createRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { routeTree } from './routeTree.gen'

/**
 * Start Sentry as early as the browser runs any app code.
 *
 * `createIsomorphicFn().client()` — *not* `createClientOnlyFn`, which compiles to a
 * stub that throws when called on the server rather than doing nothing. Here the
 * unprovided `.server()` implementation defaults to a no-op, which is what SSR needs.
 *
 * The dynamic import is separately load-bearing: it keeps `@sentry/react` out of the
 * server module graph, which Start's import-protection plugin otherwise fails the
 * build over.
 */
const initSentry = createIsomorphicFn().client(() => {
  void import('./lib/sentry.client').then((m) => m.initSentryClient())
})

export function getRouter() {
  initSentry()

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
