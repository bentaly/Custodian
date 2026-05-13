import { createFileRoute } from '@tanstack/react-router'
import { trpc } from '../../lib/trpc.js'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const { data, isLoading } = trpc.health.ping.useQuery()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">
        API status:{' '}
        {isLoading ? 'checking…' : data?.ok ? (
          <span className="text-green-600">connected</span>
        ) : (
          <span className="text-red-600">unreachable</span>
        )}
      </p>
    </div>
  )
}
