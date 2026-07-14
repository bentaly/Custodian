import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { getMe } from '../server/fns/auth'
import { listRoundDates } from '../server/fns/rounds'
import { authClient } from '../lib/auth-client'
import { Sidebar } from '../components/Sidebar'
import { AppHeader } from '../components/AppHeader'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const user = await getMe()
    if (!user) throw redirect({ to: '/sign-in' })
    // Invite-only: a signed-in user with no tenant (and not a platform superadmin)
    // has no foundation to see. getMe already tried to auto-claim a pending invite
    // by email, so reaching here means there genuinely isn't one.
    if (!user.clientId && user.role !== 'superadmin') throw redirect({ to: '/no-access' })
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
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  return (
    <div className="flex h-screen flex-col">
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar isAdmin={isAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader user={user} rounds={rounds} />
          <main className="flex-1 overflow-y-auto p-8">
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
    window.location.href = '/profile'
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm text-white">
      <span>
        Impersonating <span className="font-medium">{data?.user?.email}</span>
      </span>
      <button
        onClick={handleStop}
        className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium hover:bg-amber-700"
      >
        Stop impersonating
      </button>
    </div>
  )
}
