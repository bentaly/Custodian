import { createFileRoute } from '@tanstack/react-router'
import { listProgrammes } from '../../server/fns/programmes'

export const Route = createFileRoute('/_authenticated/funds')({
  loader: () => listProgrammes({ data: {} }),
  component: Programmes,
})

function Programmes() {
  const programmes = Route.useLoaderData()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Programmes</h1>
      <p className="mt-2 text-sm text-gray-500">{programmes.length} programmes</p>
    </div>
  )
}
