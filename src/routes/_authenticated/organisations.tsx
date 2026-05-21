import { createFileRoute } from '@tanstack/react-router'
import { listRounds } from '../../server/fns/rounds'
import { listProgrammes } from '../../server/fns/programmes'

export const Route = createFileRoute('/_authenticated/organisations')({
  loader: async () => {
    const programmes = await listProgrammes({ data: {} })
    return { programmes }
  },
  component: Rounds,
})

function Rounds() {
  const { programmes } = Route.useLoaderData()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Rounds</h1>
      <p className="mt-2 text-sm text-gray-500">{programmes.length} programmes</p>
    </div>
  )
}
