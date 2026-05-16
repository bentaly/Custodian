import { createFileRoute } from '@tanstack/react-router'
import { listApplications } from '../../server/fns/applications'

export const Route = createFileRoute('/_authenticated/applications')({
  loader: () => listApplications({ data: { page: 1, pageSize: 25 } }),
  component: Applications,
})

function Applications() {
  const data = Route.useLoaderData()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
      <p className="mt-2 text-sm text-gray-500">{data.total} applications</p>
    </div>
  )
}
