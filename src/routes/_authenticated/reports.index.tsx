import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { listReports, type ReceivedStatus, type ReportRowStatus } from '../../server/fns/reports'
import {
  Badge,
  Button,
  Card,
  DataTable,
  DateRangePicker,
  Dialog,
  EmptyState,
  FilterPill,
  Horizon,
  initials,
  Pagination,
  StatusPill,
  Tabs,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { facetLabel } from '../../lib/facets'
import { fmtDate } from '../../lib/format'
import { addMonthsIso, endOfMonthIso, todayIso } from '../../lib/schedule'

// From the server fn, not the route loader: `Route.useLoaderData` is circular here
// (the route's component uses this type), which resolves to `any`.
type ReportItem = Awaited<ReturnType<typeof listReports>>['items'][number]
/** A date we are still waiting on — the chase-list, shared by the panel and the drawer. */
type UpcomingRow = Awaited<ReturnType<typeof listReports>>['upcoming'][number]

// `report` stays a sort key even though the Report column folded into the identity cell
// below: the server still accepts it, and the label is the obvious thing to want back as
// a column the moment a foundation names its milestones something worth sorting on.
type SortKey = 'organisation' | 'programme' | 'round' | 'report' | 'received' | 'status'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['organisation', 'programme', 'round', 'report', 'received', 'status']
/** Text reads best A–Z; the received date reads best newest-first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'round', 'report', 'status']

type ReportsSearch = {
  tab?: ReceivedStatus
  programmeId?: string
  roundId?: string
  tag?: string
  from?: string
  to?: string
  sortBy?: SortKey
  sortDir?: SortDir
  page?: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export const Route = createFileRoute('/_authenticated/reports/')({
  // The tab, sort and page live in the URL, so a report you were looking at is a link
  // you can send someone — and so the loader can sort and page on the server.
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    tab: search.tab === 'received' || search.tab === 'reviewed' ? search.tab : undefined,
    programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
    roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
    tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
    from: typeof search.from === 'string' && ISO_DAY.test(search.from) ? search.from : undefined,
    to: typeof search.to === 'string' && ISO_DAY.test(search.to) ? search.to : undefined,
    sortBy: SORT_KEYS.includes(search.sortBy as SortKey) ? (search.sortBy as SortKey) : undefined,
    sortDir:
      search.sortDir === 'asc' || search.sortDir === 'desc'
        ? (search.sortDir as SortDir)
        : undefined,
    page:
      Number.isInteger(Number(search.page)) && Number(search.page) > 1
        ? Number(search.page)
        : undefined,
  }),
  loaderDeps: ({ search }) => ({
    tab: search.tab,
    programmeId: search.programmeId,
    roundId: search.roundId,
    tag: search.tag,
    from: search.from,
    to: search.to,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
    page: search.page,
  }),
  loader: async ({ deps }) =>
    listReports({
      data: {
        status: deps.tab,
        programmeId: deps.programmeId,
        roundId: deps.roundId,
        tag: deps.tag,
        from: deps.from,
        to: deps.to,
        sortBy: deps.sortBy,
        sortDir: deps.sortDir,
        page: deps.page,
      },
    }),
  component: ReportsPage,
})

const STATUS_LABELS: Record<ReportRowStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  received: 'Received',
  reviewed: 'Reviewed',
}

const STATUS_COLOURS: Record<ReportRowStatus, string> = {
  overdue: 'bg-danger/10 text-danger',
  due_soon: 'bg-warning/10 text-warning',
  upcoming: 'bg-grey-100 text-grey-600',
  received: 'bg-info/10 text-info',
  reviewed: 'bg-success/10 text-success',
}

// Hex per status for the shared StatusPill (dot + tinted background).
const STATUS_HEX: Record<ReportRowStatus, string> = {
  overdue: 'var(--color-danger)',
  due_soon: 'var(--color-warning)',
  upcoming: 'var(--color-grey-500)',
  received: 'var(--color-info)',
  reviewed: 'var(--color-success)',
}

type Tab = 'all' | ReceivedStatus

const REPORT_COLUMNS: TableColumn<ReportItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    width: 'sm:w-[36%]',
    // The house identity cell: monogram, then who it is over what it is. The milestone
    // label rides in the subline rather than a column of its own, because "Year 1 report"
    // only means anything attached to the grantee it belongs to — and a report named
    // twice on one row (subline and column) is a column's worth of width spent on nothing.
    // Round is NOT in the subline for exactly that reason: it has a column now.
    cell: (item) => {
      const subline = item.label || '—'
      return (
        <div className="flex items-center gap-2">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-chip"
            style={{ backgroundColor: C.wash }}
          >
            <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
              {initials(item.organisationName)}
            </span>
          </div>
          <div className="min-w-0">
            <Link
              to="/reports/$reportKey"
              params={{ reportKey: item.key }}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-display text-body font-medium hover:underline"
              style={{ color: C.ink }}
            >
              {item.organisationName}
            </Link>
            <p className="truncate font-display text-label" style={{ color: C.sub }}>
              {subline}
            </p>
          </div>
        </div>
      )
    },
  },
  {
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">{item.programmeName ?? '—'}</span>
    ),
  },
  {
    id: 'round',
    sortable: true,
    hideBelow: 'xl',
    header: 'Round',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">{item.roundName ?? '—'}</span>
    ),
  },
  {
    id: 'received',
    sortable: true,
    hideBelow: 'md',
    header: 'Received',
    width: 'sm:w-[160px]',
    cell: (item) => (
      <span className="whitespace-nowrap font-display text-body text-grey-500">
        {fmtDate(item.submittedAt)}
      </span>
    ),
  },
  {
    id: 'status',
    sortable: true,
    header: 'Status',
    width: 'sm:w-[140px]',
    cell: (item) => (
      <StatusPill label={STATUS_LABELS[item.status]} colour={STATUS_HEX[item.status]} />
    ),
  },
]

function ReportsPage() {
  const { items, total, pageSize, upcoming, totals, facets } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const {
    tab: tabParam,
    programmeId,
    roundId,
    tag,
    from,
    to,
    sortBy,
    sortDir,
    page,
  } = Route.useSearch()
  const tab: Tab = tabParam ?? 'all'
  const [dueOpen, setDueOpen] = useState(false)

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Switching tab always starts at page 1 — page 3 of "All" is not page 3 of "Received".
  // The sort survives it: the tab says which reports, the sort says how you read them.
  function setTab(next: Tab) {
    navigate({
      search: (prev) => ({ ...prev, tab: next === 'all' ? undefined : next, page: undefined }),
    })
  }

  // Every filter change returns to page 1 — page 3 of the old result set is a different
  // set of reports, and landing there silently is disorienting.
  function setFilter(patch: Partial<ReportsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) })
  }

  function setProgramme(next: string | undefined) {
    setFilter({ programmeId: next })
  }

  // First click sorts by the column's natural direction; clicking the active column
  // flips it. Sorting returns to page 1, for the same reason switching tab does.
  function setSort(id: string) {
    const key = id as SortKey
    const nextDir: SortDir =
      sortBy === key
        ? sortDir === 'asc'
          ? 'desc'
          : 'asc'
        : ASC_FIRST.includes(key)
          ? 'asc'
          : 'desc'
    navigate({
      search: (prev) => ({ ...prev, sortBy: key, sortDir: nextDir, page: undefined }),
    })
  }

  // "Outstanding" reads as "late" to most people, and these are mostly reports that
  // simply are not due yet — so the whole screen says "awaited", and overdue is called
  // out separately wherever it applies. Same wording as the button and the dialog.
  const received = totals.received + totals.reviewed
  const metaLine = [
    `${received} report${received === 1 ? '' : 's'} received`,
    totals.outstanding > 0 ? `${totals.outstanding} awaited` : 'none awaited',
    totals.overdue > 0 ? `${totals.overdue} overdue` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          Reports
        </h1>
        <span
          className="whitespace-nowrap font-display text-label font-medium"
          style={{ color: C.sub }}
        >
          {metaLine}
        </span>
      </div>

      {/* What is still owed, in its own card ABOVE the working surface — as Finance has
          it. It sits outside so that the tabs and the filter row are adjacent: those two
          both narrow the table and reading them as one control block is the whole point
          of the row order. The panel is about reports that have NOT arrived, so it is a
          different question from the table rather than a header for it. */}
      <ReportsDue
        rows={upcoming}
        onOpen={(key) => navigate({ to: '/reports/$reportKey', params: { reportKey: key } })}
      />

      {/* One card holds the working surface: which reports you are reading (tabs), how you
          narrow them, the rows, and the pager. */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            ariaLabel="Report status"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'all' as Tab, label: 'All', count: received },
              { id: 'received' as Tab, label: STATUS_LABELS.received, count: totals.received },
              { id: 'reviewed' as Tab, label: STATUS_LABELS.reviewed, count: totals.reviewed },
            ]}
          />
          {/* "Outstanding" read as "overdue" — the one thing these are not, necessarily.
              They are reports we are still waiting for, most of them not yet due, so the
              button says what it holds and calls the overdue ones out separately: the
              count you act on today is the smaller, redder one. */}
          <Button variant="secondary" onClick={() => setDueOpen(true)}>
            Awaiting reports
            {totals.outstanding > 0 && (
              <span className="ml-2 rounded-full bg-grey-100 px-1.5 py-0.5 text-label font-semibold text-grey-600">
                {totals.outstanding}
              </span>
            )}
            {totals.overdue > 0 && (
              <span className="ml-1 rounded-full bg-danger/10 px-1.5 py-0.5 text-label font-semibold text-danger">
                {totals.overdue} overdue
              </span>
            )}
          </Button>
        </div>

        {/* The shared filter row (see `ui/FilterPill`), in the shared order. Status is
            absent because the tabs already are it. Programme, Theme and Round narrow the
            panel above too — `listReports`' deliberate choice, since "reports for this
            programme" is a question about the table, the counts and the chase-list alike.
            The date range is the exception: it runs against the RECEIVED date, which a
            report still awaited does not have, so it narrows the table alone. */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Programme"
            plural="programmes"
            value={programmeId}
            options={facets.programmes.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={setProgramme}
          />
          <FilterPill
            label="Theme"
            plural="themes"
            value={tag}
            options={facets.themes.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={(v) => setFilter({ tag: v })}
          />
          <FilterPill
            label="Round"
            plural="rounds"
            value={roundId}
            options={facets.rounds.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={(v) => setFilter({ roundId: v })}
          />
          <DateRangePicker
            value={{ from, to }}
            onChange={(next) => setFilter({ from: next.from, to: next.to })}
            allLabel="Any received date"
          />
        </div>

        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
          <DataTable
            columns={REPORT_COLUMNS}
            rows={items}
            rowKey={(item) => item.key}
            onRowClick={(item) =>
              navigate({ to: '/reports/$reportKey', params: { reportKey: item.key } })
            }
            sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : undefined}
            onSort={setSort}
            empty={
              <div className="p-4">
                <EmptyState>
                  <p className="text-body text-grey-500">
                    {programmeId ? 'No reports for this programme.' : 'No reports received yet.'}
                  </p>
                  <p className="mt-1 text-label text-grey-400">
                    Reports appear here as soon as a grantee submits one. Dates you are still
                    waiting on are under “Awaiting reports”.
                  </p>
                </EmptyState>
              </div>
            }
          />
        </div>

        {total > 0 && (
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            shown={items.length}
            total={total}
            noun="reports"
            onChange={(p) =>
              navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
            }
          />
        )}
      </Card>

      <AwaitingReportsDialog
        open={dueOpen}
        onClose={() => setDueOpen(false)}
        rows={upcoming}
        onOpen={(key) => navigate({ to: '/reports/$reportKey', params: { reportKey: key } })}
      />
    </div>
  )
}

// ─── Reports due ─────────────────────────────────────────────────────────────
//
// The same three-horizon panel Finance wears over its payment run (`ui/Horizon`), for
// the same reason: a KPI row said four reports were overdue, which is the half of the
// answer that does not help — you chase a grantee, not a number. So each horizon names
// the grantees and the milestone owed, and the drawer behind "Outstanding" holds the
// rest.

const HORIZONS = [
  { key: 'overdue', label: 'Overdue', colour: C.danger, empty: 'Nothing overdue' },
  { key: 'thisMonth', label: 'Due this month', colour: C.warning, empty: 'Nothing due this month' },
  { key: 'next3Months', label: 'Next 3 months', colour: C.brand, empty: 'Nothing else scheduled' },
] as const

/** How many a horizon names before it just says how many more there are. */
const HORIZON_SHOWN = 4

function horizonBuckets(
  rows: UpcomingRow[],
): Record<(typeof HORIZONS)[number]['key'], UpcomingRow[]> {
  const today = todayIso()
  const monthEnd = endOfMonthIso(today)
  // Three ROLLING months, as Finance has them: in the last month of a calendar quarter
  // that bucket would be structurally empty, so a third of the year the panel would
  // carry a dead card.
  const horizon = addMonthsIso(today, 3)
  return {
    // Overdue is read off the row's own `status` rather than a second date comparison,
    // so a milestone the drawer badges "Overdue" can never land in a different card here.
    overdue: rows.filter((r) => r.status === 'overdue'),
    thisMonth: rows.filter((r) => r.dueDate >= today && r.dueDate <= monthEnd),
    next3Months: rows.filter((r) => r.dueDate > monthEnd && r.dueDate <= horizon),
  }
}

function ReportsDue({
  rows,
  onOpen,
}: {
  rows: UpcomingRow[]
  onOpen: (reportKey: string) => void
}) {
  const buckets = horizonBuckets(rows)
  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        Reports due
      </h2>
      <div className="grid gap-2 lg:grid-cols-3">
        {HORIZONS.map((h) => {
          const bucket = buckets[h.key]
          return (
            <Horizon
              key={h.key}
              label={h.label}
              colour={h.colour}
              empty={h.empty}
              meta={bucket.length > 0 ? bucket.length : undefined}
              items={bucket.slice(0, HORIZON_SHOWN).map((r) => ({
                key: r.key,
                title: r.organisationName,
                subline: [r.label, r.programmeName].filter(Boolean).join(' · '),
                trailing: fmtDate(r.dueDate),
                // A milestone id is a valid `reportKey`, so an awaited report opens on its
                // own screen — where the grant, the grantee's other reports and what else
                // is outstanding from them sit, which is what you need to chase it.
                onClick: () => onOpen(r.key),
              }))}
              hidden={bucket.length - Math.min(bucket.length, HORIZON_SHOWN)}
              hiddenNoun="report"
            />
          )
        })}
      </div>
    </Card>
  )
}

/**
 * Every report we are still waiting on, most urgent first. Deliberately not in the main
 * table: these are a chase-list, not documents to read.
 *
 * A modal rather than the old slide-over, which is now the app's one panel-over-the-page
 * pattern (`ui/Dialog`) — and which is why this stopped hand-rolling Escape, the backdrop,
 * focus handling and the scroll lock, all of which the dialog already gets right.
 */
function AwaitingReportsDialog({
  open,
  onClose,
  rows,
  onOpen,
}: {
  open: boolean
  onClose: () => void
  rows: UpcomingRow[]
  onOpen: (reportKey: string) => void
}) {
  const overdue = rows.filter((r) => r.status === 'overdue').length
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Awaiting reports"
      description={
        rows.length === 0
          ? 'Nothing awaited'
          : `${rows.length} awaited, most urgent first${overdue > 0 ? ` · ${overdue} overdue` : ''}`
      }
    >
      {rows.length === 0 ? (
        <p className="text-body text-grey-500">
          Every scheduled report has been received. New dates appear here when an award is
          generated.
        </p>
      ) : (
        <ul className="divide-y divide-grey-100">
          {rows.map((r) => (
            <li key={r.key}>
              {/* The same click target the panel's horizons offer, for the same reason:
                  chasing a report starts on the report's own screen. */}
              <button
                type="button"
                onClick={() => onOpen(r.key)}
                className="flex w-full items-start justify-between gap-3 rounded-chip py-3 text-left hover:bg-grey-50"
              >
                <div className="min-w-0 px-2">
                  <p className="truncate text-body font-medium text-grey-900">
                    {r.organisationName}
                  </p>
                  <p className="mt-0.5 truncate text-label text-grey-500">
                    {r.label}
                    {r.programmeName ? ` · ${r.programmeName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 px-2 text-right">
                  <Badge className={STATUS_COLOURS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  <p
                    className={`mt-1 whitespace-nowrap text-label ${
                      r.status === 'overdue' ? 'font-medium text-danger' : 'text-grey-500'
                    }`}
                  >
                    {fmtDate(r.dueDate)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
