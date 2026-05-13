import { createFileRoute } from '@tanstack/react-router'
import { trpc } from '../../lib/trpc.js'

export const Route = createFileRoute('/_authenticated/applications')({
  component: Applications,
})

function Applications() {
  const { data, isLoading } = trpc.applications.list.useQuery({})

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
      {isLoading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
      {data && (
        <p className="mt-2 text-sm text-gray-500">{data.total} applications</p>
      )}
    </div>
  )
}
