import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const { session } = Route.useRouteContext()
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Welcome back, {session.user.name}</p>
    </div>
  )
}
