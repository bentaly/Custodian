import { createFileRoute, Link } from '@tanstack/react-router'
import { getApplication } from '../../server/fns/applications'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  loader: ({ params }) => getApplication({ data: { id: params.applicationId } }),
  component: ApplicationDetail,
})

function ApplicationDetail() {
  const application = Route.useLoaderData()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link to="/applications" search={{ roundId: undefined }} className="hover:text-gray-600">Applications</Link>
        <span>›</span>
        <span className="text-gray-600">{application.organisationName}</span>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900">{application.organisationName}</h1>
    </div>
  )
}
