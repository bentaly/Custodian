import { createFileRoute, useRouter } from '@tanstack/react-router'
import { listApplications } from '../../server/fns/applications'

export const Route = createFileRoute('/_authenticated/applications/')({
  loader: () => listApplications({ data: { page: 1, pageSize: 25 } }),
  component: ApplicationsList,
})

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-50 text-blue-700',
  under_review: 'bg-yellow-50 text-yellow-700',
  shortlisted: 'bg-purple-50 text-purple-700',
  approved: 'bg-green-50 text-green-700',
  declined: 'bg-red-50 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-500',
}

function formatAmount(amount: string | null | undefined) {
  if (!amount) return '—'
  const n = parseFloat(amount)
  if (isNaN(n)) return '—'
  return `£${n.toLocaleString('en-GB')}`
}

function ApplicationsList() {
  const router = useRouter()
  const { items, total } = Route.useLoaderData()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
        <p className="mt-1 text-sm text-gray-500">{total} application{total !== 1 ? 's' : ''}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-gray-500">No applications yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Programme</th>
                <th className="px-5 py-3">Tags</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((app) => (
                <tr
                  key={app.id}
                  onClick={() =>
                    router.navigate({
                      to: '/applications/$applicationId',
                      params: { applicationId: app.id },
                    })
                  }
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-5 py-3 font-medium text-gray-900">{app.organisationName}</td>
                  <td className="px-5 py-3 text-gray-600">{formatAmount(app.amountRequested)}</td>
                  <td className="px-5 py-3 text-gray-600">{app.programme?.name ?? '—'}</td>
                  <td className="px-5 py-3">
                    {app.programme?.tags && app.programme.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {app.programme.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {STATUS_LABELS[app.status] ?? app.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
