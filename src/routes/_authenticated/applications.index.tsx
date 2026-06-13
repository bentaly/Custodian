import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { listApplications } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { DueDiligenceBadge } from '../../components/dueDiligence'
import type { DueDiligenceStatus } from '../../lib/dueDiligence'
import { getRoundStatus } from '../../lib/roundStatus'

export const Route = createFileRoute('/_authenticated/applications/')({
  validateSearch: (search: Record<string, unknown>) => ({
    roundId: typeof search.roundId === 'string' ? search.roundId : undefined as string | undefined,
  }),
  loaderDeps: ({ search }) => ({ roundId: search.roundId }),
  loader: async ({ deps }) => {
    const [applicationsData, rounds] = await Promise.all([
      listApplications({ data: { page: 1, pageSize: 25, roundId: deps.roundId } }),
      listMyRounds(),
    ])
    return { ...applicationsData, rounds }
  },
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
  const navigate = useNavigate({ from: '/applications/' })
  const { roundId } = Route.useSearch()
  const { items, total, rounds } = Route.useLoaderData()

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aDate = a.closedAt ? new Date(a.closedAt).getTime() : Infinity
      const bDate = b.closedAt ? new Date(b.closedAt).getTime() : Infinity
      return bDate - aDate
    })

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    navigate({ search: { roundId: e.target.value || undefined } })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
          <p className="mt-1 text-sm text-gray-500">{total} application{total !== 1 ? 's' : ''}</p>
        </div>
        {visibleRounds.length > 0 && (
          <select
            value={roundId ?? ''}
            onChange={handleRoundChange}
            className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="">All rounds</option>
            {visibleRounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{getRoundStatus(r) === 'open' ? ' (current)' : getRoundStatus(r) === 'closed' ? ' (closed)' : ''}
              </option>
            ))}
          </select>
        )}
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
                <th className="px-5 py-3">Due diligence</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((app) => (
                <tr key={app.id} className="relative transition-colors hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    <Link
                      to="/applications/$applicationId"
                      params={{ applicationId: app.id }}
                      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded focus-visible:after:ring-2 focus-visible:after:ring-gray-400"
                    >
                      {app.organisationName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{formatAmount(app.amountRequested)}</td>
                  <td className="px-5 py-3 text-gray-600">{app.roundProgramme?.programme?.name ?? '—'}</td>
                  <td className="px-5 py-3">
                    {app.roundProgramme?.programme?.tags && (app.roundProgramme.programme.tags as string[]).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(app.roundProgramme.programme.tags as string[]).map((tag) => (
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
                    <DueDiligenceBadge status={(app.dueDiligenceStatus ?? 'pending') as DueDiligenceStatus} />
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
