import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { getMe } from '../server/fns/auth'
import { authClient } from '../lib/auth-client'

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
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <div className="flex h-screen flex-col">
      <ImpersonationBanner />
      <TopNav />
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
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

function TopNav() {
  const navigate = useNavigate()
  const { user } = Route.useRouteContext()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  async function handleSignOut() {
    await authClient.signOut()
    navigate({ to: '/sign-in' })
  }

  const linkClass =
    'rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 [&.active]:bg-gray-100 [&.active]:font-medium'

  return (
    <header className="flex items-center gap-6 border-b border-gray-200 bg-white px-6 py-3">
      <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, letterSpacing: '-0.3px' }} className="text-gray-900">Custodian<span style={{ color: '#1D9E75' }}>.</span></p>
      <nav className="flex flex-1 items-center gap-1">
        <Link to="/dashboard" className={linkClass}>
          Dashboard
        </Link>
        <Link to="/rounds" className={linkClass}>
          Rounds
        </Link>
        <Link to="/programmes" className={linkClass}>
          Programmes
        </Link>
        <Link to="/applications" search={{ roundId: undefined }} className={linkClass}>
          Applications
        </Link>
        <Link to="/shortlist" search={{ roundId: undefined }} className={linkClass}>
          Shortlist
        </Link>
        <Link to="/reports" className={linkClass}>
          Reports
        </Link>
        <Link to="/record" search={{ roundId: undefined }} className={linkClass}>
          Record
        </Link>
        {isAdmin && (
          <Link to="/users" className={linkClass}>
            Organisation
          </Link>
        )}
      </nav>
      <div className="flex items-center gap-1">
        <Link to="/profile" className={linkClass}>
          Profile
        </Link>
        <button
          onClick={handleSignOut}
          className="rounded px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
