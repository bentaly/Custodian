import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { getMe } from '../server/fns/auth'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const user = await getMe()
    if (!user) throw redirect({ to: '/sign-in' })
    return { user }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}

function Sidebar() {
  const navigate = useNavigate()
  const { user } = Route.useRouteContext()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  async function handleSignOut() {
    await authClient.signOut()
    navigate({ to: '/sign-in' })
  }

  const linkClass =
    'block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 [&.active]:bg-gray-100 [&.active]:font-medium'

  return (
    <aside className="flex w-56 flex-col border-r border-gray-200 bg-white px-4 py-6">
      <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, letterSpacing: '-0.3px' }} className="text-gray-900">Custodian<span style={{ color: '#1D9E75' }}>.</span></p>
      <nav className="mt-6 flex-1 space-y-1">
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
        <Link to="/awards" search={{ roundId: undefined }} className={linkClass}>
          Awards
        </Link>
        {isAdmin && (
          <Link to="/users" className={linkClass}>
            Organization
          </Link>
        )}
      </nav>
      <div className="space-y-1 border-t border-gray-100 pt-4">
        <Link to="/profile" className={linkClass}>
          Profile
        </Link>
        <button
          onClick={handleSignOut}
          className="block w-full rounded px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
