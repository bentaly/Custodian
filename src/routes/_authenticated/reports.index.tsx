import { createFileRoute, Link } from '@tanstack/react-router'
import {
  listReports,
  REPORTS_ARRIVED_DEFAULT_SORT,
  REPORTS_AWAITED_DEFAULT_SORT,
  type ReportRowStatus,
} from '../../server/fns/reports'
import {
  Card,
  DataTable,
  DateText,
  DateRangePicker,
  EmptyState,
  FilterPill,
  Horizon,
  initials,
  Pagination,
  StatusPill,
  Tabs,
  TruncatedList,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { facetLabel } from '../../lib/facets'
import { fmtDate, fmtRef } from '../../lib/format'

// From the server fn, not the route loader: `Route.useLoaderData` is circular here
// (the route's component uses this type), which resolves to `any`.
type ReportItem = Awaited<ReturnType<typeof listReports>>['items'][number]
/** A date nobody has answered yet — the Awaiting tab's row. */
type AwaitingItem = Awaited<ReturnType<typeof listReports>>['awaiting'][number]
type Horizons = Awaited<ReturnType<typeof listReports>>['horizons']

type SortKey = 'organisation' | 'programme' | 'round' | 'report' | 'received' | 'due'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['organisation', 'programme', 'round', 'report', 'received', 'due']
/** Text reads best A–Z; the received date newest-first, and a due date soonest-first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'round', 'report', 'due']

type ReportsSearch = {
  tab?: Tab
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
    // `to_review` is the default and so has no value in the URL — it is the work sitting
    // with you, and the app lands on its first tab everywhere else.
    tab: search.tab === 'reviewed' || search.tab === 'awaiting' ? search.tab : undefined,
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
        tab: deps.tab,
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

// Hex per status for the shared StatusPill (dot + tinted background).
const STATUS_HEX: Record<ReportRowStatus, string> = {
  overdue: 'var(--color-danger)',
  due_soon: 'var(--color-warning)',
  upcoming: 'var(--color-grey-500)',
  received: 'var(--color-info)',
  reviewed: 'var(--color-success)',
}

/**
 * The reporting lifecycle, left to right. The two document tabs sit together because
 * they hold the same kind of row at two stages; `awaiting` holds a different kind — a
 * date nobody has answered — so it goes last, and the screen lands on the first tab as
 * every other screen does. There is deliberately no "All": it would mix documents with
 * expectations, which is the merge that made a never-submitted milestone look like a
 * report in the first place.
 */
type Tab = 'to_review' | 'reviewed' | 'awaiting'

const REPORT_COLUMNS: TableColumn<ReportItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    width: 'sm:w-[28%]',
    // The house identity cell: monogram, then who it is over what it is. The subtext is
    // the foundation's OWN reference for the grant — the same fact in the same place as on
    // the Applications list, so a row can be tied back to their other systems without
    // opening it. The milestone label left the subline when it gained a column of its
    // own; nothing on a row is stated twice.
    cell: (item) => {
      const subline = fmtRef(item.externalApplicationId) ?? '—'
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
    // What the report IS — "Year 1 report", "Final report", whatever the foundation named
    // the milestone. It has a column rather than riding in the subline because it is the
    // one fact that tells two reports from the same grantee apart, and because the row's
    // subtext is now the foundation's own reference. Sortable: the server has taken this
    // key all along.
    id: 'report',
    sortable: true,
    header: 'Report',
    width: 'sm:w-[180px]',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">{item.label || '—'}</span>
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
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">{item.programmeName ?? '—'}</span>
    ),
  },
  {
    // Filterable, so readable: the Theme pill has to leave a visible mark on the rows it
    // keeps. Not sortable — a grant carrying three themes has no place in an ordering.
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[160px]',
    cell: (item) => (
      <TruncatedList
        items={item.tags}
        label="Themes for this grant"
        className={`font-display text-body ${
          item.tags.length > 0 ? 'text-grey-500' : 'text-grey-400'
        }`}
      />
    ),
  },
  {
    id: 'received',
    sortable: true,
    hideBelow: 'md',
    header: 'Received',
    width: 'sm:w-[160px]',
    cell: (item) => (
      <DateText
        value={item.submittedAt}
        className="whitespace-nowrap font-display text-body text-grey-500"
      />
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

/**
 * The Awaiting tab's columns. Same leading columns as the documents table, so switching
 * tab does not move the grantee, the report, the round and the programme out from under
 * you — then Due rather than Received, and a status from the other vocabulary
 * (`overdue` / `due_soon` / `upcoming`), because these rows have not arrived and cannot
 * be "reviewed".
 */
const AWAITING_COLUMNS: TableColumn<AwaitingItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    width: 'sm:w-[28%]',
    cell: (item) => (
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
            {fmtRef(item.externalApplicationId) ?? '—'}
          </p>
        </div>
      </div>
    ),
  },
  {
    // The milestone's own name, as on the documents table — the two tabs keep the same
    // leading columns, so switching tab does not move a fact out from under you.
    id: 'report',
    sortable: true,
    header: 'Report',
    width: 'sm:w-[180px]',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">{item.label || '—'}</span>
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
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">{item.programmeName ?? '—'}</span>
    ),
  },
  {
    // Filterable, so readable: the Theme pill has to leave a visible mark on the rows it
    // keeps. Not sortable — a grant carrying three themes has no place in an ordering.
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[160px]',
    cell: (item) => (
      <TruncatedList
        items={item.tags}
        label="Themes for this grant"
        className={`font-display text-body ${
          item.tags.length > 0 ? 'text-grey-500' : 'text-grey-400'
        }`}
      />
    ),
  },
  {
    id: 'due',
    sortable: true,
    hideBelow: 'md',
    header: 'Due',
    width: 'sm:w-[160px]',
    cell: (item) => (
      <DateText
        value={item.dueDate}
        className={`whitespace-nowrap font-display text-body ${
          item.status === 'overdue' ? 'font-medium text-danger' : 'text-grey-500'
        }`}
      />
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[140px]',
    cell: (item) => (
      <StatusPill label={STATUS_LABELS[item.status]} colour={STATUS_HEX[item.status]} />
    ),
  },
]

function ReportsPage() {
  const { items, awaiting, total, pageSize, tabCounts, horizons, facets } = Route.useLoaderData()
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
  const tab: Tab = tabParam ?? 'to_review'

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Switching tab always starts at page 1 — page 3 of one tab is not page 3 of another.
  // The sort does NOT survive it: the two document tabs sort by a received date the
  // awaited list has not got, so carrying it over would order by a column that isn't there.
  function setTab(next: Tab) {
    navigate({
      search: (prev) => ({
        ...prev,
        tab: next === 'to_review' ? undefined : next,
        sortBy: undefined,
        sortDir: undefined,
        page: undefined,
      }),
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
  // out separately wherever it applies.
  const received = tabCounts.to_review + tabCounts.reviewed
  const overdue = horizons.overdue.count
  const metaLine = [
    `${received} report${received === 1 ? '' : 's'} received`,
    tabCounts.awaiting > 0 ? `${tabCounts.awaiting} awaited` : 'none awaited',
    overdue > 0 ? `${overdue} overdue` : null,
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
        horizons={horizons}
        onOpen={(key) => navigate({ to: '/reports/$reportKey', params: { reportKey: key } })}
      />

      {/* One card holds the working surface: which reports you are reading (tabs), how you
          narrow them, the rows, and the pager. */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* "To review" rather than "Received": every reviewed report was received too,
              so that pair named overlapping sets. This one names the work. The overdue
              count is deliberately NOT repeated on the Awaiting tab — the panel directly
              above carries it in red, and the same alarm twice reads as two problems. */}
          <Tabs
            ariaLabel="Reporting stage"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'to_review' as Tab, label: 'To review', count: tabCounts.to_review },
              { id: 'reviewed' as Tab, label: 'Reviewed', count: tabCounts.reviewed },
              { id: 'awaiting' as Tab, label: 'Awaiting', count: tabCounts.awaiting },
            ]}
          />
        </div>

        {/* The shared filter row (see `ui/FilterPill`), in the shared order. Status is
            absent because the tabs already are it. Round, Programme and Theme narrow the
            panel above too — `listReports`' deliberate choice, since "reports for this
            programme" is a question about the table, the counts and the chase-list alike.
            The date range is the exception: it runs against the RECEIVED date, which a
            report still awaited does not have, so it narrows the table alone. */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Round"
            plural="rounds"
            value={roundId}
            options={facets.rounds.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={(v) => setFilter({ roundId: v })}
          />
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
          {/* The window runs against the RECEIVED date, which an awaited report has not
              got — so on that tab the control is not hidden state, it is absent. The
              value stays in the URL: switching back restores the window rather than
              silently dropping the filter you set. It still narrows the two document
              tabs' counts while you are away, which is what those counts are about. */}
          {tab !== 'awaiting' && (
            <DateRangePicker
              value={{ from, to }}
              onChange={(next) => setFilter({ from: next.from, to: next.to })}
              allLabel="Any received date"
            />
          )}
        </div>

        {/* Two column sets over one table: an arrived report is a document with a date
            it came in on, an awaited one is a date with nobody's document against it.
            The tab says which you are looking at, so the columns follow it — the same
            way Finance's two tabs carry a different date column each. */}
        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
          {tab === 'awaiting' ? (
            <DataTable
              columns={AWAITING_COLUMNS}
              rows={awaiting}
              rowKey={(item) => item.key}
              // A milestone id is a valid `reportKey`, so an awaited report opens on its
              // own screen — where the grant, the grantee's other reports and what else
              // is outstanding from them sit, which is what you need to chase it.
              onRowClick={(item) =>
                navigate({ to: '/reports/$reportKey', params: { reportKey: item.key } })
              }
              // Each tab has its OWN default — most overdue first when chasing,
              // most recent first when reading — so each header marks its own.
              sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : REPORTS_AWAITED_DEFAULT_SORT}
              onSort={setSort}
              empty={
                <div className="p-4">
                  <EmptyState>
                    <p className="text-body text-grey-500">Nothing awaited.</p>
                    <p className="mt-1 text-label text-grey-400">
                      Reporting dates appear here as soon as a grant is set up with a schedule.
                    </p>
                  </EmptyState>
                </div>
              }
            />
          ) : (
            <DataTable
              columns={REPORT_COLUMNS}
              rows={items}
              rowKey={(item) => item.key}
              onRowClick={(item) =>
                navigate({ to: '/reports/$reportKey', params: { reportKey: item.key } })
              }
              sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : REPORTS_ARRIVED_DEFAULT_SORT}
              onSort={setSort}
              empty={
                <div className="p-4">
                  <EmptyState>
                    <p className="text-body text-grey-500">
                      {tab === 'reviewed'
                        ? 'Nothing signed off yet.'
                        : 'Nothing waiting to be reviewed.'}
                    </p>
                    <p className="mt-1 text-label text-grey-400">
                      Reports appear here as soon as a grantee submits one. Dates you are still
                      waiting on are under “Awaiting”.
                    </p>
                  </EmptyState>
                </div>
              }
            />
          )}
        </div>

        {total > 0 && (
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            shown={tab === 'awaiting' ? awaiting.length : items.length}
            total={total}
            noun="reports"
            onChange={(p) =>
              navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
            }
          />
        )}
      </Card>
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

function ReportsDue({
  horizons,
  onOpen,
}: {
  horizons: Horizons
  onOpen: (reportKey: string) => void
}) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        Reports due
      </h2>
      <div className="grid gap-2 lg:grid-cols-3">
        {HORIZONS.map((h) => {
          const bucket = horizons[h.key]
          return (
            <Horizon
              key={h.key}
              label={h.label}
              colour={h.colour}
              empty={h.empty}
              meta={bucket.count > 0 ? bucket.count : undefined}
              items={bucket.items.map((r) => ({
                key: r.key,
                title: r.organisationName,
                subline: [r.label, r.programmeName].filter(Boolean).join(' · '),
                trailing: fmtDate(r.dueDate),
                // A milestone id is a valid `reportKey`, so an awaited report opens on its
                // own screen — where the grant, the grantee's other reports and what else
                // is outstanding from them sit, which is what you need to chase it.
                onClick: () => onOpen(r.key),
              }))}
              hidden={bucket.count - bucket.items.length}
              hiddenNoun="report"
            />
          )
        })}
      </div>
    </Card>
  )
}
