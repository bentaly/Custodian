import { createFileRoute } from '@tanstack/react-router'
import { listFunds } from '../../server/fns/funds'

export const Route = createFileRoute('/_authenticated/funds')({
  loader: () => listFunds(),
  component: Funds,
})

function Funds() {
  const funds = Route.useLoaderData()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Funds</h1>
      <p className="mt-2 text-sm text-gray-500">{funds.length} funds</p>
    </div>
  )
}
