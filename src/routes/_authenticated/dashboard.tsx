import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/dashboard')({
  beforeLoad: ({ context }) => {
    // A platform superadmin has no tenant data — send them to Profile, which hosts
    // the impersonation console.
    if (context.user.role === 'superadmin') throw redirect({ to: '/profile' })
  },
  component: Dashboard,
})

function Dashboard() {
  const { user } = Route.useRouteContext()
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Welcome back, {user.name}</p>
    </div>
  )
}
