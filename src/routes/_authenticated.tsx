import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { getSession } from '../server/fns/auth'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/sign-in' })
    return { session }
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

  async function handleSignOut() {
    await authClient.signOut()
    navigate({ to: '/sign-in' })
  }

  const linkClass =
    'block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 [&.active]:bg-gray-100 [&.active]:font-medium'

  return (
    <aside className="flex w-64 flex-col border-r border-gray-200 bg-white px-4 py-6">
      <p className="text-lg font-semibold text-gray-900">Custodian</p>
      <nav className="mt-6 flex-1 space-y-1">
        <Link to="/dashboard" className={linkClass}>
          Dashboard
        </Link>
        <Link to="/applications" className={linkClass}>
          Applications
        </Link>
        <Link to="/funds" className={linkClass}>
          Funds
        </Link>
        <Link to="/organisations" className={linkClass}>
          Organisations
        </Link>
      </nav>
      <button
        onClick={handleSignOut}
        className="mt-4 block w-full rounded px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
      >
        Sign out
      </button>
    </aside>
  )
}
