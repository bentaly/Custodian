import { createFileRoute } from '@tanstack/react-router'
import { listOrganisations } from '../../server/fns/organisations'

export const Route = createFileRoute('/_authenticated/organisations')({
  loader: () => listOrganisations({ data: {} }),
  component: Organisations,
})

function Organisations() {
  const organisations = Route.useLoaderData()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Organisations</h1>
      <p className="mt-2 text-sm text-gray-500">{organisations.length} organisations</p>
    </div>
  )
}
