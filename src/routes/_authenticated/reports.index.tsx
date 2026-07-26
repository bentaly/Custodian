import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  listReports,
  type DueStatus,
  type ReceivedStatus,
  type ReportRowStatus,
} from '../../server/fns/reports'
import { Alert02Icon, Calendar03Icon, File01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  KPI_TINTS,
  MiniKpi,
  StatusPill,
  Tabs,
  type TableColumn,
} from '../../components/ui'
import { Drawer } from '../../components/Drawer'
import { fmtDate } from '../../lib/format'

// From the server fn, not the route loader: `Route.useLoaderData` is circular here
// (the route's component uses this type), which resolves to `any`.
type ReportItem = Awaited<ReturnType<typeof listReports>>['items'][number]

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

// Hex per status for the shared StatusPill (dot + tinted background).
const STATUS_HEX: Record<ReportRowStatus, string> = {
  overdue: '#FF4242',
  due_soon: '#9B6916',
  upcoming: '#637083',
  received: '#3B82C4',
  reviewed: '#31A650',
}


type Tab = 'all' | ReceivedStatus

const REPORT_COLUMNS: TableColumn<ReportItem>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    width: 'w-[28%]',
    cell: (item) => (
      <Link
        to="/reports/$reportKey"
        params={{ reportKey: item.key }}
        onClick={(e) => e.stopPropagation()}
        className="font-display text-[14px] font-medium text-[#141C24] hover:underline"
      >
        {item.organisationName}
      </Link>
    ),
  },
  { id: 'programme', header: 'Programme', cell: (item) => <span className="font-display text-[14px] text-[#637083]">{item.programmeName ?? '—'}</span> },
  { id: 'report', header: 'Report', cell: (item) => <span className="font-display text-[14px] text-[#637083]">{item.label}</span> },
  {
    id: 'received',
    header: 'Received',
    width: 'w-[160px]',
    cell: (item) => <span className="whitespace-nowrap font-display text-[14px] text-[#637083]">{fmtDate(item.submittedAt)}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    width: 'w-[140px]',
    cell: (item) => <StatusPill label={STATUS_LABELS[item.status]} color={STATUS_HEX[item.status]} />,
  },
]

function ReportsPage() {
  const { items, upcoming, totals } = Route.useLoaderData()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [dueOpen, setDueOpen] = useState(false)

  const filtered = tab === 'all' ? items : items.filter((i) => i.status === tab)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[21px] font-semibold text-gray-900">Reports</h1>
          <p className="mt-0.5 text-sm text-gray-400">Reports received from grantees</p>
        </div>
        <Button variant="secondary" onClick={() => setDueOpen(true)}>
          Outstanding
          {totals.outstanding > 0 && (
            <span
              className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                totals.overdue > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {totals.outstanding}
            </span>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniKpi
          tint={KPI_TINTS.violet}
          icon={File01Icon}
          label="Awaiting review"
          value={String(totals.received)}
          sub="received, not yet signed off"
        />
        <MiniKpi
          tint={KPI_TINTS.green}
          icon={Tick02Icon}
          label="Reviewed"
          value={String(totals.reviewed)}
          sub="signed off"
        />
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={Alert02Icon}
          label="Overdue"
          value={String(totals.overdue)}
          valueColor={totals.overdue > 0 ? '#FF4242' : undefined}
          sub="follow-up needed"
        />
        <MiniKpi
          tint={KPI_TINTS.amber}
          icon={Calendar03Icon}
          label="Due soon"
          value={String(totals.dueSoon)}
          sub="within 30 days"
        />
      </div>

      <Tabs
        ariaLabel="Report status"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'all' as Tab, label: 'All', count: items.length },
          { id: 'received' as Tab, label: STATUS_LABELS.received, count: totals.received },
          { id: 'reviewed' as Tab, label: STATUS_LABELS.reviewed, count: totals.reviewed },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-gray-500">No reports received yet.</p>
          <p className="mt-1 text-xs text-gray-400">
            Reports appear here as soon as a grantee submits one. Dates you are still waiting on are
            under “Outstanding”.
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
          <DataTable
            columns={REPORT_COLUMNS}
            rows={filtered}
            rowKey={(item) => item.key}
            onRowClick={(item) => navigate({ to: '/reports/$reportKey', params: { reportKey: item.key } })}
          />
        </div>
      )}

      <OutstandingDrawer open={dueOpen} onClose={() => setDueOpen(false)} rows={upcoming} />
    </div>
  )
}

/**
 * Dates we are still waiting on. Deliberately not in the main table: these are a
 * chase-list, not documents to read.
 */
function OutstandingDrawer({
  open,
  onClose,
  rows,
}: {
  open: boolean
  onClose: () => void
  rows: Array<{
    key: string
    organisationName: string
    programmeName: string | null
    label: string
    dueDate: string
    status: DueStatus
  }>
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Outstanding reports"
      subtitle={rows.length === 0 ? 'Nothing outstanding' : `${rows.length} awaited, most urgent first`}
      ariaLabel="Outstanding reports"
    >
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            Every scheduled report has been received. New dates appear here when an award is generated.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{r.organisationName}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {r.label}
                    {r.programmeName ? ` · ${r.programmeName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  <p
                    className={`mt-1 whitespace-nowrap text-xs ${
                      r.status === 'overdue' ? 'font-medium text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {fmtDate(r.dueDate)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  )
}
