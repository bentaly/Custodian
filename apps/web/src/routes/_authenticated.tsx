import { createFileRoute, Outlet } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    )
  }

  if (!session) {
    window.location.replace('/sign-in')
    return null
  }

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
  return (
    <aside className="w-64 border-r border-gray-200 bg-white px-4 py-6 flex flex-col">
      <p className="text-lg font-semibold text-gray-900">Custodian</p>
      <nav className="mt-6 space-y-1 flex-1">
        <a href="/dashboard" className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Dashboard
        </a>
        <a href="/applications" className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Applications
        </a>
        <a href="/funds" className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Funds
        </a>
        <a href="/organisations" className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Organisations
        </a>
      </nav>
      <button
        onClick={() => authClient.signOut().then(() => window.location.replace('/sign-in'))}
        className="mt-4 block w-full rounded px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
      >
        Sign out
      </button>
    </aside>
  )
}
