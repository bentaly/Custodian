import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { listReports, type ReportRowStatus } from '../../server/fns/reports'
import { Badge, Card, EmptyState } from '../../components/ui'

export const Route = createFileRoute('/_authenticated/reports/')({
  loader: async () => listReports(),
  component: ReportsPage,
})

const STATUS_LABELS: Record<ReportRowStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  received: 'Received',
  reviewed: 'Reviewed',
}

const STATUS_COLORS: Record<ReportRowStatus, string> = {
  overdue: 'bg-red-50 text-red-700',
  due_soon: 'bg-amber-50 text-amber-700',
  upcoming: 'bg-gray-100 text-gray-600',
  received: 'bg-blue-50 text-blue-700',
  reviewed: 'bg-emerald-50 text-emerald-700',
}

function fmtDate(date: Date | string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

type Tab = 'all' | ReportRowStatus

function ReportsPage() {
  const { items, totals } = Route.useLoaderData()
  const [tab, setTab] = useState<Tab>('all')

  const filtered = tab === 'all' ? items : items.filter((i) => i.status === tab)

  const tabBase = 'rounded-full border px-3 py-1 text-xs transition-colors'
  const tabOn = 'border-emerald-600 bg-emerald-50 font-medium text-emerald-700'
  const tabOff = 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'

  return (
    <div className="space-y-4">
      <div>
        <h1
          style={{ fontFamily: "'DM Serif Display', serif", fontSize: 21, fontWeight: 400 }}
          className="text-gray-900"
        >
          Reports
        </h1>
        <p className="mt-0.5 text-sm text-gray-400">Grantee reporting schedules and submissions</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active" value={totals.active} sub="Scheduled from awards" />
        <StatCard
          label="Overdue"
          value={totals.overdue}
          sub="Follow-up needed"
          valueClass={totals.overdue > 0 ? 'text-red-600' : undefined}
        />
        <StatCard label="Due soon" value={totals.dueSoon} sub="Within 30 days" />
        <StatCard label="Received" value={totals.received} sub="Awaiting review" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'overdue', 'due_soon', 'upcoming', 'received', 'reviewed'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`${tabBase} ${tab === t ? tabOn : tabOff}`}
          >
            {t === 'all' ? 'All' : STATUS_LABELS[t]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-gray-500">No reports here.</p>
          <p className="mt-1 text-xs text-gray-400">
            Reporting milestones are set when an award is generated; submitted reports land against
            them automatically.
          </p>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Programme</th>
                <th className="px-5 py-3">Report</th>
                <th className="px-5 py-3">Due</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => (
                <tr key={item.key} className="relative transition-colors hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    <Link
                      to="/reports/$reportKey"
                      params={{ reportKey: item.key }}
                      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded focus-visible:after:ring-2 focus-visible:after:ring-gray-400"
                    >
                      {item.organisationName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{item.programmeName ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{item.label}</td>
                  <td
                    className={`whitespace-nowrap px-5 py-3 ${
                      item.status === 'overdue' ? 'font-medium text-red-600' : 'text-gray-600'
                    }`}
                  >
                    {fmtDate(item.dueDate)}
                  </td>
                  <td className="px-5 py-3">
                    <Badge className={STATUS_COLORS[item.status]}>
                      {STATUS_LABELS[item.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string
  value: number
  sub: string
  valueClass?: string
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueClass ?? 'text-gray-900'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
    </Card>
  )
}
