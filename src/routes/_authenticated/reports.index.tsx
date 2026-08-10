import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  listReports,
  type DueStatus,
  type ReceivedStatus,
  type ReportRowStatus,
} from '../../server/fns/reports'
import { Alert02Icon, Audit02Icon, Calendar03Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  KPI_TINTS,
  MiniKpi,
  Pagination,
  StatusPill,
  Tabs,
  type TableColumn,
} from '../../components/ui'
import { Drawer } from '../../components/Drawer'
import { fmtDate } from '../../lib/format'

// From the server fn, not the route loader: `Route.useLoaderData` is circular here
// (the route's component uses this type), which resolves to `any`.
type ReportItem = Awaited<ReturnType<typeof listReports>>['items'][number]

type ReportsSearch = { tab?: ReceivedStatus; page?: number }

export const Route = createFileRoute('/_authenticated/reports/')({
  // The tab and the page live in the URL, so a report you were looking at is a link you
  // can send someone — and so the loader can page on the server.
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    tab: search.tab === 'received' || search.tab === 'reviewed' ? search.tab : undefined,
    page:
      Number.isInteger(Number(search.page)) && Number(search.page) > 1
        ? Number(search.page)
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab, page: search.page }),
  loader: async ({ deps }) => listReports({ data: { status: deps.tab, page: deps.page } }),
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
  overdue: 'bg-danger/10 text-danger',
  due_soon: 'bg-warning/10 text-warning',
  upcoming: 'bg-gray-100 text-gray-600',
  received: 'bg-info/10 text-info',
  reviewed: 'bg-success/10 text-success',
}

// Hex per status for the shared StatusPill (dot + tinted background).
const STATUS_HEX: Record<ReportRowStatus, string> = {
  overdue: 'var(--color-danger)',
  due_soon: 'var(--color-warning)',
  upcoming: 'var(--color-gray-500)',
  received: 'var(--color-info)',
  reviewed: 'var(--color-success)',
}

type Tab = 'all' | ReceivedStatus

const REPORT_COLUMNS: TableColumn<ReportItem>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    width: 'sm:w-[28%]',
    cell: (item) => (
      <Link
        to="/reports/$reportKey"
        params={{ reportKey: item.key }}
        onClick={(e) => e.stopPropagation()}
        className="font-display text-body font-medium text-gray-900 hover:underline"
      >
        {item.organisationName}
      </Link>
    ),
  },
  {
    id: 'programme',
    hideBelow: 'lg',
    header: 'Programme',
    cell: (item) => (
      <span className="font-display text-body text-gray-500">{item.programmeName ?? '—'}</span>
    ),
  },
  {
    id: 'report',
    hideBelow: 'sm',
    header: 'Report',
    cell: (item) => <span className="font-display text-body text-gray-500">{item.label}</span>,
  },
  {
    id: 'received',
    hideBelow: 'md',
    header: 'Received',
    width: 'sm:w-[160px]',
    cell: (item) => (
      <span className="whitespace-nowrap font-display text-body text-gray-500">
        {fmtDate(item.submittedAt)}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[140px]',
    cell: (item) => (
      <StatusPill label={STATUS_LABELS[item.status]} color={STATUS_HEX[item.status]} />
    ),
  },
]

function ReportsPage() {
  const { items, total, pageSize, upcoming, totals } = Route.useLoaderData()
  const navigate = useNavigate()
  const { tab: tabParam, page } = Route.useSearch()
  const tab: Tab = tabParam ?? 'all'
  const [dueOpen, setDueOpen] = useState(false)

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Switching tab always starts at page 1 — page 3 of "All" is not page 3 of "Received".
  function setTab(next: Tab) {
    navigate({
      to: '/reports',
      search: { tab: next === 'all' ? undefined : next, page: undefined },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-heading font-medium text-gray-900">Reports</h1>
        <Button variant="secondary" onClick={() => setDueOpen(true)}>
          Outstanding
          {totals.outstanding > 0 && (
            <span
              className={`ml-2 rounded-full px-1.5 py-0.5 text-label font-semibold ${
                totals.overdue > 0 ? 'bg-danger/10 text-danger' : 'bg-gray-100 text-gray-600'
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
          icon={Audit02Icon}
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
          valueColor={totals.overdue > 0 ? 'var(--color-danger)' : undefined}
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
          { id: 'all' as Tab, label: 'All', count: totals.received + totals.reviewed },
          { id: 'received' as Tab, label: STATUS_LABELS.received, count: totals.received },
          { id: 'reviewed' as Tab, label: STATUS_LABELS.reviewed, count: totals.reviewed },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState>
          <p className="text-body text-gray-500">No reports received yet.</p>
          <p className="mt-1 text-label text-gray-400">
            Reports appear here as soon as a grantee submits one. Dates you are still waiting on are
            under “Outstanding”.
          </p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-card border border-gray-200 bg-white">
            <DataTable
              columns={REPORT_COLUMNS}
              rows={items}
              rowKey={(item) => item.key}
              onRowClick={(item) =>
                navigate({ to: '/reports/$reportKey', params: { reportKey: item.key } })
              }
            />
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            shown={items.length}
            total={total}
            noun="reports"
            onChange={(p) =>
              navigate({ to: '/reports', search: { tab: tabParam, page: p > 1 ? p : undefined } })
            }
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
      subtitle={
        rows.length === 0 ? 'Nothing outstanding' : `${rows.length} awaited, most urgent first`
      }
      ariaLabel="Outstanding reports"
    >
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {rows.length === 0 ? (
          <p className="text-body text-gray-500">
            Every scheduled report has been received. New dates appear here when an award is
            generated.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-gray-900">{r.organisationName}</p>
                  <p className="mt-0.5 truncate text-label text-gray-500">
                    {r.label}
                    {r.programmeName ? ` · ${r.programmeName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  <p
                    className={`mt-1 whitespace-nowrap text-label ${
                      r.status === 'overdue' ? 'font-medium text-danger' : 'text-gray-500'
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
