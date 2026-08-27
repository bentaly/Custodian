import { createRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { routeTree } from './routeTree.gen'
import { RouteError } from './components/ui/RouteError'
import { notFoundError } from './lib/errors'
import { installRequestTimeout } from './lib/requestTimeout'
import { installStaleChunkReload } from './lib/staleChunk'

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

/**
 * Put a deadline on every request to our own server, before the router makes any.
 *
 * Client-only for the same reason as Sentry above, but with more at stake: on the
 * server this same global `fetch` is how the Worker reaches Neon, Companies House and
 * Resend, which carry their own bounds and must not inherit a browser's.
 *
 * Imported statically, unlike Sentry: a dynamic import installs a tick late, and the
 * requests it would miss are the first page's loaders — exactly the ones that hung on
 * 9 Aug. The module has no browser-only dependency to keep out of the server graph, and
 * does nothing at import time.
 */
const initRequestTimeout = createIsomorphicFn().client(installRequestTimeout)

/**
 * Recover from a deploy that landed while someone had the app open. Client-only for the
 * obvious reason — there is no `window` on the server — and installed here so it is
 * listening before the router preloads its first chunk on hover.
 */
const initStaleChunkReload = createIsomorphicFn().client(installStaleChunkReload)

export function getRouter() {
  initSentry()
  initRequestTimeout()
  initStaleChunkReload()

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    /**
     * Loader results survive 30 seconds of navigation.
     *
     * Until this existed the default was `0`: not one route in the app set `staleTime`,
     * so every navigation refetched everything it had just fetched. Preloads were
     * covered (`defaultPreloadStaleTime` defaults to 30s) but real navigations were not,
     * which is backwards — hovering was cheaper than clicking.
     *
     * Mutations are unaffected: `router.invalidate()` marks matches `invalid`, and
     * `load-matches` reloads an invalid match whatever its stale time. So the window
     * only covers changes made by SOMEONE ELSE, which on a foundation's board of a
     * handful of people is a fair trade for not re-querying on every back button.
     *
     * `_authenticated`'s own loader keeps its longer 5 minutes; a per-route value still
     * wins over this.
     */
    defaultStaleTime: 30_000,
    // Assigned to whichever route threw, so the failure renders at that route's own
    // position — inside `_authenticated`'s <Outlet /> for app pages, keeping the
    // sidebar and header. See RouteError for why this is not on the layout route.
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: () => (
      <RouteError error={notFoundError('We could not find that record.')} />
    ),
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
