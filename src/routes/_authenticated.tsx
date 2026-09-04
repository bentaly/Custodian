import { useEffect, useState } from 'react'
import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { APP_SCROLL_ID } from '../lib/appScroll'
import { currentUser, invalidateCurrentUser } from '../lib/currentUser'
import { safeReturnPath } from '../lib/signInRedirect'
import { listRoundDates } from '../server/fns/rounds'
import { authClient } from '../lib/auth-client'
import { Sidebar } from '../components/Sidebar'
import { AppHeader } from '../components/AppHeader'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const user = await currentUser()
    // Carry where they were trying to go, so signing in finishes the journey instead
    // of landing them on the dashboard. Same parameter the 401 interceptor uses.
    if (!user) {
      const from = safeReturnPath(location.href)
      throw redirect({ to: '/sign-in', search: from ? { redirect: from } : {} })
    }
    // A superadmin's screen is `/platform`, and the test is the ROLE, not the absence
    // of a `client_id`. Those look equivalent — a platform user is supposed to have no
    // tenant — but the column is what actually drifts: promote an existing foundation
    // admin and they keep the client they came from, and provisioning can set one by
    // hand. Keyed on the column, this guard admits exactly the superadmin it exists to
    // turn away, which is what happened on 4 Sep 2026: Google sign-in landed a
    // superadmin whose `client_id` still pointed at an old test tenant in that
    // foundation's shell. That is the 3 Sep 2026 report's shape too — the role-based
    // scope exemption serves every tenant's applications while the header pill names
    // only the stale one. See the header comment on `routes/platform.tsx`.
    //
    // Impersonation is unaffected: BetterAuth swaps the session to the member, so by
    // the time this runs the role is theirs and the shell is the right answer.
    if (user.role === 'superadmin') throw redirect({ to: '/platform' })
    // Anyone else with no tenant is an invite that never landed. getMe already tried to
    // auto-claim a pending invite by email, so reaching here means there isn't one.
    if (!user.clientId) throw redirect({ to: '/no-access' })
    return { user }
  },
  // Round names + dates for the header status line; cached so per-page
  // navigations within the shell don't re-query.
  loader: async () => ({ rounds: await listRoundDates() }),
  staleTime: 5 * 60 * 1000,
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext()
  const { rounds } = Route.useLoaderData()
  const [navOpen, setNavOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Any navigation closes the drawer — including ones that don't come from a nav link
  // (a breadcrumb, the search dropdown, the back button).
  useEffect(() => setNavOpen(false), [pathname])

  return (
    <div className="flex h-screen flex-col">
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar mobileOpen={navOpen} onClose={() => setNavOpen(false)} role={user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader user={user} rounds={rounds} onOpenNav={() => setNavOpen(true)} />
          {/* 16px all round at every width — the design's page gutter (Figma 126:31899).

              THE app's scroll container: the shell is pinned to the viewport, so the
              window never scrolls and every screen scrolls inside here. That is why it
              carries a restoration id — the router's `scrollRestoration` only knows
              about `window` unless an element names itself, so opening an application
              from halfway down the list used to land you halfway down the application.
              `scrollToTopSelectors` in `src/router.tsx` names this id; the two have to
              stay in step. */}
          <main
            data-scroll-restoration-id={APP_SCROLL_ID}
            className="flex-1 overflow-y-auto bg-white p-4"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

function ImpersonationBanner() {
  const { data } = authClient.useSession()
  const impersonating = !!data?.session?.impersonatedBy
  if (!impersonating) return null

  async function handleStop() {
    await authClient.admin.stopImpersonating()
    invalidateCurrentUser()
    // Back to the console, not to `/profile` — a superadmin with no tenant of their own
    // would be bounced straight out of this shell by the guard above.
    window.location.href = '/platform'
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-warning px-4 py-2 text-body text-white">
      <span>
        Impersonating <span className="font-medium">{data?.user?.email}</span>
      </span>
      <button
        onClick={handleStop}
        className="rounded-chip bg-warning px-2 py-0.5 text-label font-medium hover:bg-warning"
      >
        Stop impersonating
      </button>
    </div>
  )
}
