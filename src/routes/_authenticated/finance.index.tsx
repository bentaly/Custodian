import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  listFinanceGrants,
  getFinanceGrant,
  FINANCE_STATUS_LABELS,
  type BankStatus,
  type FinanceStatus,
  type UpcomingBucket,
} from '../../server/fns/finance'
import { PaymentDialog, type FinanceGrant } from '../../components/PaymentDialog'
import {
  Card,
  DataTable,
  DateRangePicker,
  EmptyState,
  ExportButton,
  FilterPill,
  Pagination,
  StatusPill,
  Tabs,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { facetLabel } from '../../lib/facets'
import { messageFor } from '../../lib/errors'
import { fmtDate, fmtMoney } from '../../lib/format'

// Derived from the server fn rather than the route loader: `Route.useLoaderData` is
// circular here (the route's component uses these types), which resolves to `any`.
type FinanceData = Awaited<ReturnType<typeof listFinanceGrants>>
type FinanceRow = FinanceData['items'][number]
type Totals = FinanceData['totals']

type SortKey =
  | 'organisation'
  | 'programme'
  | 'committed'
  | 'paid'
  | 'next'
  | 'lastPaid'
  | 'bank'
  | 'status'
type SortDir = 'asc' | 'desc'

type FinanceSearch = {
  tab?: 'paid'
  roundId?: string
  tag?: string
  status?: FinanceStatus
  from?: string
  to?: string
  sortBy?: SortKey
  sortDir?: SortDir
  page?: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const FINANCE_STATUSES = Object.keys(FINANCE_STATUS_LABELS) as FinanceStatus[]
const SORT_KEYS: SortKey[] = [
  'organisation',
  'programme',
  'committed',
  'paid',
  'next',
  'lastPaid',
  'bank',
  'status',
]
/** Text reads best A–Z; money, dates and the two urgency ranks read best worst-first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme']

export const Route = createFileRoute('/_authenticated/finance/')({
  // Tab, filters and page in the URL: a view you cannot link to is a view you lose
  // every time you open a payment and come back.
  validateSearch: (search: Record<string, unknown>): FinanceSearch => ({
    tab: search.tab === 'paid' ? 'paid' : undefined,
    roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
    tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
    status: FINANCE_STATUSES.includes(search.status as FinanceStatus)
      ? (search.status as FinanceStatus)
      : undefined,
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
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    listFinanceGrants({
      data: {
        tab: deps.tab ?? 'to_pay',
        roundId: deps.roundId,
        tag: deps.tag,
        status: deps.status,
        from: deps.from,
        to: deps.to,
        sortBy: deps.sortBy,
        sortDir: deps.sortDir,
        page: deps.page,
      },
    }),
  component: FinancePage,
})

// ─── Formatting ──────────────────────────────────────────────────────────────

/** "in 4 days" / "12 days ago" — the thing a finance officer actually reads off a due date. */
function relativeDays(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null
  const today = new Date().toISOString().slice(0, 10)
  const days = Math.round(
    (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  )
  if (days === 0) return { text: 'today', overdue: false }
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} ago`, overdue: true }
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, overdue: false }
}

const STATUS_HEX: Record<FinanceStatus, string> = {
  overdue: 'var(--color-danger)',
  due_soon: 'var(--color-warning)',
  scheduled: 'var(--color-gray-500)',
  unscheduled: 'var(--color-warning)',
  paid: 'var(--color-success)',
  cancelled: 'var(--color-gray-400)',
}

const BANK_ISSUE_LABELS: Partial<Record<BankStatus, string>> = {
  missing: 'No details',
  invalid: 'Check failed',
  unchecked: 'Unverified',
}

const txtSub = 'font-display text-body text-gray-500'

// ─── Columns ─────────────────────────────────────────────────────────────────

const ORGANISATION: TableColumn<FinanceRow> = {
  id: 'organisation',
  sortable: true,
  header: 'Organisation',
  cell: (g) => (
    <span className="font-display text-body font-medium text-gray-900">{g.organisationName}</span>
  ),
}

const PROGRAMME: TableColumn<FinanceRow> = {
  id: 'programme',
  sortable: true,
  hideBelow: 'lg',
  header: 'Programme',
  cell: (g) => <span className={txtSub}>{g.programmeName ?? '—'}</span>,
}

const COMMITTED: TableColumn<FinanceRow> = {
  id: 'committed',
  sortable: true,
  header: 'Committed',
  width: 'sm:w-[120px]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <span className="whitespace-nowrap font-display text-body font-medium text-gray-900">
      {fmtMoney(g.committed)}
    </span>
  ),
}

const PAID: TableColumn<FinanceRow> = {
  id: 'paid',
  sortable: true,
  hideBelow: 'lg',
  header: 'Paid',
  width: 'sm:w-[130px]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <div className="whitespace-nowrap">
      <span className={txtSub}>{g.paidToDate > 0 ? fmtMoney(g.paidToDate) : '—'}</span>
      {g.instalmentCount > 0 && (
        <span className="ml-1 font-display text-label text-gray-400">
          {g.paidCount}/{g.instalmentCount}
        </span>
      )}
    </div>
  ),
}

const BANK: TableColumn<FinanceRow> = {
  id: 'bank',
  sortable: true,
  hideBelow: 'xl',
  header: 'Bank',
  width: 'sm:w-[120px]',
  cell: (g) => {
    const issue = BANK_ISSUE_LABELS[g.bank.status]
    if (!issue) {
      return (
        <span className="whitespace-nowrap font-display text-body tabular-nums text-gray-500">
          ••••{g.bank.last4 ?? '—'}
        </span>
      )
    }
    return (
      <span
        className="whitespace-nowrap font-display text-body font-medium"
        style={{
          color: g.bank.status === 'missing' ? 'var(--color-warning)' : 'var(--color-danger)',
        }}
      >
        {issue}
      </span>
    )
  },
}

const STATUS: TableColumn<FinanceRow> = {
  id: 'status',
  sortable: true,
  header: 'Status',
  width: 'sm:w-[130px]',
  cell: (g) => <StatusPill label={FINANCE_STATUS_LABELS[g.status]} color={STATUS_HEX[g.status]} />,
}

const TO_PAY_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  PROGRAMME,
  COMMITTED,
  PAID,
  {
    id: 'next',
    sortable: true,
    hideBelow: 'sm',
    header: 'Next payment',
    width: 'sm:w-[170px]',
    cellClassName: 'tabular-nums',
    cell: (g) => {
      if (!g.nextPayment) {
        return <span className="font-display text-body text-gray-400">No schedule</span>
      }
      const rel = relativeDays(g.nextPayment.dueDate)
      return (
        <div className="whitespace-nowrap">
          <div className="font-display text-body font-medium text-gray-900">
            {fmtMoney(g.nextPayment.amount)}
          </div>
          <div
            className="font-display text-label"
            style={{ color: rel?.overdue ? 'var(--color-danger)' : 'var(--color-gray-400)' }}
          >
            {g.nextPayment.dueDate
              ? `${fmtDate(g.nextPayment.dueDate)} · ${rel!.text}`
              : 'Date TBC'}
          </div>
        </div>
      )
    },
  },
  BANK,
  STATUS,
]

const PAID_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  PROGRAMME,
  COMMITTED,
  PAID,
  {
    id: 'lastPaid',
    sortable: true,
    hideBelow: 'sm',
    header: 'Last payment',
    width: 'sm:w-[150px]',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{fmtDate(g.lastPaidDate)}</span>,
  },
  BANK,
  STATUS,
]

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = 'to_pay' | 'paid'

function FinancePage() {
  const {
    items: rows,
    total,
    pageSize,
    tabCounts,
    totals,
    upcoming,
    facets,
  } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const search = Route.useSearch()
  const { tab: tabParam, roundId, tag, status, from, to, sortBy, sortDir, page } = search
  const tab: Tab = tabParam ?? 'to_pay'

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const [error, setError] = useState('')

  // The payment panel is a dialog over this list, not a route: the schedule is a handful
  // of rows, and a finance officer working a payment run wants the list still behind it.
  // Like the round dialog, the grant's own detail is fetched on open rather than carried
  // on every row.
  const [grant, setGrant] = useState<FinanceGrant | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  async function openGrant(awardId: string) {
    setError('')
    setOpening(awardId)
    try {
      setGrant(await getFinanceGrant({ data: { id: awardId } }))
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setOpening(null)
    }
  }

  // A schedule edit changes both the dialog and the list under it — the row's next
  // payment, the tab counts and the upcoming panel all move.
  async function refreshGrant() {
    if (!grant) return
    const [next] = await Promise.all([
      getFinanceGrant({ data: { id: grant.id } }),
      router.invalidate(),
    ])
    setGrant(next)
  }

  // The tab split ("to pay" is anything still owing; settled and cancelled grants sit
  // under "Paid", so every grant appears under exactly one) happens on the server,
  // because a page has to be a page of the tab.
  function setTab(next: Tab) {
    navigate({
      search: (prev) => ({
        ...prev,
        tab: next === 'to_pay' ? undefined : next,
        // The status pill's options are the ones present on the tab, so a status carried
        // across the switch would be a filter with nothing behind it.
        status: undefined,
        // Likewise the two date columns: each exists on one tab only, so carrying that
        // sort over would leave the list ordered by a column that isn't on screen.
        ...(prev.sortBy === 'next' || prev.sortBy === 'lastPaid'
          ? { sortBy: undefined, sortDir: undefined }
          : {}),
        page: undefined,
      }),
    })
  }

  function setFilter(patch: Partial<FinanceSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) })
  }

  // First click sorts by the column's natural direction; clicking the active column
  // flips it. Same convention as the applications, awards and reports tables.
  function setSort(id: string) {
    const key = id as SortKey
    navigate({
      search: (prev) => {
        const active = prev.sortBy === key
        const nextDir: SortDir = active
          ? prev.sortDir === 'asc'
            ? 'desc'
            : 'asc'
          : ASC_FIRST.includes(key)
            ? 'asc'
            : 'desc'
        return { ...prev, sortBy: key, sortDir: nextDir, page: undefined }
      },
    })
  }

  // The export is the whole filtered set, not the page on screen — a reconciliation file
  // with 25 of 300 rows in it would be worse than none.
  const [exporting, setExporting] = useState(false)
  async function handleExport() {
    setExporting(true)
    try {
      const all = await listFinanceGrants({
        data: { tab, roundId, tag, status, from, to, sortBy, sortDir, page: 1, pageSize: 10_000 },
      })
      exportCsv(all.items, tab)
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-heading font-medium text-gray-900">Finance</h1>
        <p className="mt-0.5 text-body text-gray-400">
          Grant payments · {totals.grantCount} live commitment{totals.grantCount === 1 ? '' : 's'}
        </p>
      </div>

      {error && <p className="font-display text-body text-danger">{error}</p>}

      <UpcomingPayments upcoming={upcoming} onOpen={openGrant} opening={opening} />

      {(totals.bankIssueCount > 0 || totals.unscheduledCount > 0) && <Attention totals={totals} />}

      <Card className="flex flex-col gap-4 p-4">
        {/* Tabs and the export sit on one row, as the comp has them — the export belongs
            to the list it exports, not to the page. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            ariaLabel="Payment status"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'to_pay', label: 'To pay', count: tabCounts.to_pay },
              { id: 'paid', label: 'Paid', count: tabCounts.paid },
            ]}
          />
          <ExportButton onClick={handleExport} busy={exporting} disabled={rows.length === 0} />
        </div>

        {/* Each pill offers only what this tab actually contains, with counts; a pill with
            nothing to choose between isn't rendered at all. */}
        <div className="flex flex-wrap items-center gap-3">
          {facets.statuses.length > 1 && (
            <FilterPill
              label="Status"
              clearLabel="All statuses"
              value={status}
              options={facets.statuses.map((f) => ({ value: f.value, label: facetLabel(f) }))}
              onChange={(v) => setFilter({ status: (v as FinanceStatus) || undefined })}
            />
          )}
          {facets.themes.length > 1 && (
            <FilterPill
              label="Theme"
              clearLabel="All themes"
              value={tag}
              options={facets.themes.map((f) => ({ value: f.value, label: facetLabel(f) }))}
              onChange={(v) => setFilter({ tag: v })}
            />
          )}
          {facets.rounds.length > 1 && (
            <FilterPill
              label="Round"
              clearLabel="All rounds"
              value={roundId}
              options={facets.rounds.map((f) => ({ value: f.value, label: facetLabel(f) }))}
              onChange={(v) => setFilter({ roundId: v })}
            />
          )}
          {/* The window runs against the date the open tab is about: the next payment due
              on "To pay", the last one made on "Paid". */}
          <DateRangePicker
            value={{ from, to }}
            onChange={(next) => setFilter({ from: next.from, to: next.to })}
            allLabel={tab === 'paid' ? 'Any payment date' : 'Any due date'}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState>
            <p className="text-body text-gray-500">
              {status || tag || roundId || from || to
                ? 'No grants match these filters.'
                : tab === 'to_pay'
                  ? 'Nothing outstanding — every grant is paid up.'
                  : 'No payments made yet.'}
            </p>
            <p className="mt-1 text-label text-gray-400">
              Grants appear here as soon as an award is generated, with the instalment schedule set
              on the award.
            </p>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-hidden rounded-chip border border-gray-200">
              <DataTable
                columns={tab === 'to_pay' ? TO_PAY_COLUMNS : PAID_COLUMNS}
                rows={rows}
                rowKey={(g) => g.awardId}
                rowClassName={(g) => (opening === g.awardId ? 'opacity-60' : '')}
                onRowClick={(g) => openGrant(g.awardId)}
                sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : undefined}
                onSort={setSort}
              />
            </div>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              shown={rows.length}
              total={total}
              noun="grants"
              onChange={(p) =>
                navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
              }
            />
          </>
        )}
      </Card>

      {grant && (
        <PaymentDialog grant={grant} onClose={() => setGrant(null)} onChanged={refreshGrant} />
      )}
    </div>
  )
}

// ─── Upcoming payments ───────────────────────────────────────────────────────

/**
 * The three horizons a payment run is planned over (Figma 665:25047), replacing the
 * KPI row that used to sit here. The difference is that these name the payments rather
 * than only totalling them: "£35k overdue" tells you there is a problem, "Nature
 * Learning Network, due 10 Jun" tells you whose.
 *
 * Deliberately NOT narrowed by the filters below it — this is the screen's standing
 * "what is coming at you" strip.
 */
const HORIZONS = [
  { key: 'overdue', label: 'Overdue', colour: C.danger, empty: 'Nothing overdue' },
  { key: 'thisMonth', label: 'Due this month', colour: C.warning, empty: 'Nothing due this month' },
  { key: 'next3Months', label: 'Next 3 months', colour: C.brand, empty: 'Nothing else scheduled' },
] as const

function UpcomingPayments({
  upcoming,
  onOpen,
  opening,
}: {
  upcoming: FinanceData['upcoming']
  onOpen: (awardId: string) => void
  opening: string | null
}) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="font-display text-title font-medium text-gray-900">Upcoming payments</h2>
      <div className="grid gap-2 lg:grid-cols-3">
        {HORIZONS.map((h) => (
          <Horizon
            key={h.key}
            label={h.label}
            colour={h.colour}
            empty={h.empty}
            bucket={upcoming[h.key]}
            onOpen={onOpen}
            opening={opening}
          />
        ))}
      </div>
    </Card>
  )
}

function Horizon({
  label,
  colour,
  empty,
  bucket,
  onOpen,
  opening,
}: {
  label: string
  colour: string
  empty: string
  bucket: UpcomingBucket
  onOpen: (awardId: string) => void
  opening: string | null
}) {
  const hidden = bucket.count - bucket.items.length
  return (
    <div className="flex flex-col gap-2 rounded-card border border-gray-200 bg-white p-1">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-[5px] shrink-0 rounded-full"
            style={{ backgroundColor: colour }}
          />
          <span className="font-display text-title font-medium" style={{ color: colour }}>
            {label}
          </span>
        </span>
        {bucket.count > 0 && (
          <span className="whitespace-nowrap font-display text-label font-medium text-gray-400 tabular-nums">
            {fmtMoney(bucket.total)} · {bucket.count}
          </span>
        )}
      </div>
      <div
        className="flex flex-1 flex-col gap-3 rounded-control p-3"
        style={{ backgroundColor: `color-mix(in srgb, ${colour} 10%, transparent)` }}
      >
        {bucket.items.length === 0 ? (
          <p className="font-display text-body text-gray-400">{empty}</p>
        ) : (
          bucket.items.map((p, i) => (
            <button
              key={`${p.awardId}-${p.dueDate}-${i}`}
              type="button"
              onClick={() => onOpen(p.awardId)}
              disabled={opening === p.awardId}
              className="flex w-full items-center justify-between gap-3 border-t border-gray-200 pt-3 text-left first:border-t-0 first:pt-0 disabled:opacity-60"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-display text-body font-medium text-gray-900">
                  {p.organisationName}
                </span>
                <span className="truncate font-display text-label text-gray-500">
                  {p.programmeName ? `${p.programmeName} · ` : ''}Due {fmtDate(p.dueDate)}
                </span>
              </span>
              <span
                className="shrink-0 whitespace-nowrap font-display text-title font-medium tabular-nums"
                style={{ color: colour }}
              >
                {fmtMoney(p.amount)}
              </span>
            </button>
          ))
        )}
        {hidden > 0 && (
          <p className="font-display text-label font-medium text-gray-500">
            +{hidden} more payment{hidden === 1 ? '' : 's'} in this window
          </p>
        )}
      </div>
    </div>
  )
}

/** The two things that stop a payment run before it starts. */
function Attention({ totals }: { totals: Totals }) {
  const parts: string[] = []
  if (totals.bankIssueCount > 0) {
    parts.push(
      `${totals.bankIssueCount} grant${totals.bankIssueCount === 1 ? ' has' : 's have'} missing or invalid bank details`,
    )
  }
  if (totals.unscheduledCount > 0) {
    parts.push(
      `${totals.unscheduledCount} grant${totals.unscheduledCount === 1 ? ' has' : 's have'} no payment schedule`,
    )
  }
  return (
    <div className="rounded-control border border-warning/20 bg-warning/10 px-4 py-3">
      <p className="text-body text-warning">
        <span className="font-medium">Needs attention · </span>
        {parts.join(' · ')}. These cannot be paid until fixed.
      </p>
    </div>
  )
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * A reconciliation export of the current tab — the figures on screen, as a
 * spreadsheet. Deliberately NOT a payment file: it carries only the masked account
 * (last four), so it can be shared without handing over payable bank details.
 */
function exportCsv(rows: FinanceRow[], tab: Tab) {
  const header = [
    'Organisation',
    'Programme',
    'Round',
    'Committed',
    'Paid to date',
    'Outstanding',
    'Instalments paid',
    'Next payment',
    'Next payment due',
    'Last paid',
    'Status',
    'Bank',
    'Account (last 4)',
  ]
  const body = rows.map((g) => [
    g.organisationName,
    g.programmeName ?? '',
    g.roundName ?? '',
    g.committed,
    g.paidToDate,
    g.outstanding,
    `${g.paidCount}/${g.instalmentCount}`,
    g.nextPayment?.amount ?? '',
    g.nextPayment?.dueDate ?? '',
    g.lastPaidDate ?? '',
    FINANCE_STATUS_LABELS[g.status],
    g.bank.status,
    g.bank.last4 ?? '',
  ])
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `custodian-finance-${tab === 'to_pay' ? 'to-pay' : 'paid'}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
