import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { listApplications, getRoundBudgetSummary } from '../../server/fns/applications'
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
    const rounds = await listMyRounds()

    // Default to the most recent non-upcoming round when no roundId is in the URL
    let roundId = deps.roundId
    if (!roundId) {
      const candidate = rounds
        .filter((r) => getRoundStatus(r) !== 'upcoming')
        .sort((a, b) => {
          const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
          const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
          return bT - aT
        })[0]
      if (candidate) throw redirect({ to: '/applications', search: { roundId: candidate.id } })
    }

    const [applicationsData, budgetSummary] = await Promise.all([
      listApplications({ data: { page: 1, pageSize: 25, roundId } }),
      roundId ? getRoundBudgetSummary({ data: { roundId } }) : Promise.resolve([]),
    ])
    return { ...applicationsData, rounds, budgetSummary }
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

function fmtAmount(amount: string | null | undefined) {
  if (!amount) return '—'
  const n = parseFloat(amount)
  if (isNaN(n)) return '—'
  return `£${n.toLocaleString('en-GB')}`
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

type BudgetRow = Awaited<ReturnType<typeof getRoundBudgetSummary>>[number]

function ProgrammeBudgetRow({ row }: { row: BudgetRow }) {
  const hasBudget = row.budget !== null

  if (!hasBudget) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-36 truncate text-xs text-gray-600" title={row.programmeName}>
          {row.programmeName}
        </span>
        <div className="flex-1" />
        <span className="text-xs tabular-nums text-gray-500">
          {row.committed > 0 ? fmtCompact(row.committed) : '—'} committed
        </span>
        <span className="w-24 text-right text-xs text-gray-300">No budget set</span>
      </div>
    )
  }

  const pct = Math.min(100, (row.committed / row.budget!) * 100)
  const remaining = row.budget! - row.committed
  const isOver = remaining < 0
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className="flex items-center gap-3">
      <span className="w-36 truncate text-xs text-gray-600" title={row.programmeName}>
        {row.programmeName}
      </span>
      <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 5 }}>
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 text-right text-xs tabular-nums text-gray-500">
        {fmtCompact(row.committed)} / {fmtCompact(row.budget!)}
      </span>
      <span className={`w-24 text-right text-xs tabular-nums ${isOver ? 'font-medium text-red-500' : 'text-gray-400'}`}>
        {isOver ? `${fmtCompact(-remaining)} over` : `${fmtCompact(remaining)} left`}
      </span>
    </div>
  )
}

function BudgetPanel({ rows }: { rows: BudgetRow[] }) {
  if (rows.length === 0) return null

  const rowsWithBudget = rows.filter((r) => r.budget !== null)
  const hasBudgets = rowsWithBudget.length > 1
  const totalBudget = rowsWithBudget.reduce((s, r) => s + r.budget!, 0)
  const totalCommitted = rows.reduce((s, r) => s + r.committed, 0)
  const totalPct = totalBudget > 0 ? Math.min(100, (totalCommitted / totalBudget) * 100) : 0
  const totalRemaining = totalBudget - totalCommitted
  const isOver = totalRemaining < 0
  const totalBarColor = totalPct >= 100 ? 'bg-red-500' : totalPct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Budget</p>

      {hasBudgets && (
        <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
          <span className="w-36 text-xs font-medium text-gray-500">All programmes</span>
          <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 5 }}>
            <div className={`h-full rounded-full transition-all ${totalBarColor}`} style={{ width: `${totalPct}%` }} />
          </div>
          <span className="w-28 text-right text-xs font-medium tabular-nums text-gray-700">
            {fmtCompact(totalCommitted)} / {fmtCompact(totalBudget)}
          </span>
          <span className={`w-24 text-right text-xs font-medium tabular-nums ${isOver ? 'text-red-500' : 'text-gray-500'}`}>
            {isOver ? `${fmtCompact(-totalRemaining)} over` : `${fmtCompact(totalRemaining)} left`}
          </span>
        </div>
      )}

      <div className="space-y-2.5">
        {rows.map((row) => (
          <ProgrammeBudgetRow key={row.roundProgrammeId} row={row} />
        ))}
      </div>
    </div>
  )
}

function ApplicationsList() {
  const navigate = useNavigate({ from: '/applications/' })
  const { roundId } = Route.useSearch()
  const { items, total, rounds, budgetSummary } = Route.useLoaderData()

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
      const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
      return bT - aT
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
            {visibleRounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{getRoundStatus(r) === 'open' ? ' (current)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {budgetSummary.length > 0 && <BudgetPanel rows={budgetSummary} />}

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
                  <td className="px-5 py-3 text-gray-600">{fmtAmount(app.amountRequested)}</td>
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
