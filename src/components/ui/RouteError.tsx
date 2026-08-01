import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { captureException } from '@sentry/react'
import { statusOf } from '../../lib/errors'
import { shouldIgnore } from '../../lib/sentry'
import { ErrorState } from './ErrorState'

/**
 * The router's default boundary, used by every route that doesn't set its own.
 *
 * Registered on the router (see src/router.tsx) rather than on `_authenticated`,
 * and that distinction is the whole point: a route's own `errorComponent` renders
 * *in place of* that route's component, so putting one on the layout would strip the
 * sidebar and header — the navigation the user needs to escape the error. Assigned as
 * a router default it lands on the route that actually threw, which for an app page
 * means inside the layout's `<Outlet />`, chrome intact.
 */
export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter()

  useEffect(() => {
    // Loader failures never touch a React error boundary, so this is the only place a
    // route-level fault gets reported. 4xx are expected and already shown to the user.
    if (!shouldIgnore(error) && statusOf(error) >= 500) captureException(error)
  }, [error])

  return (
    <ErrorState
      error={error}
      onRetry={() => {
        reset?.()
        // `reset` alone only clears the boundary — if the loader threw, re-rendering
        // just throws again. Invalidating re-runs it, which is what "try again" means.
        void router.invalidate()
      }}
    />
  )
}
