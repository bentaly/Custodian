import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  listFinanceGrants,
  getFinanceGrant,
  BANK_STATUS_LABELS,
  FINANCE_STATUS_LABELS,
  FINANCE_DEFAULT_SORT,
  type BankStatus,
  type FinanceStatus,
  type UpcomingBucket,
} from '../../server/fns/finance'
import { PaymentDialog, type FinanceGrant } from '../../components/PaymentDialog'
import { getFinanceNav } from '../../server/fns/budget'
import { FinanceHeader } from '../../components/finance/FinanceHeader'
import {
  Card,
  DataTable,
  DateRangePicker,
  EmptyState,
  ExportButton,
  FilterPill,
  FilterRow,
  SearchInput,
  Horizon,
  Pagination,
  StatusPill,
  Tabs,
  TruncatedList,
  TruncatedText,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { facetLabel } from '../../lib/facets'
import { messageFor } from '../../lib/errors'
import { fmtDate, fmtMoney, fmtRef } from '../../lib/format'

// Derived from the server fn rather than the route loader: `Route.useLoaderData` is
// circular here (the route's component uses these types), which resolves to `any`.
type FinanceData = Awaited<ReturnType<typeof listFinanceGrants>>
type FinanceRow = FinanceData['items'][number]
type Totals = FinanceData['totals']

type SortKey =
  | 'organisation'
  | 'programme'
  | 'round'
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
  programmeId?: string
  tag?: string
  status?: FinanceStatus
  bank?: BankStatus
  from?: string
  to?: string
  q?: string
  sortBy?: SortKey
  sortDir?: SortDir
  page?: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const FINANCE_STATUSES = Object.keys(FINANCE_STATUS_LABELS) as FinanceStatus[]
const BANK_STATUSES = Object.keys(BANK_STATUS_LABELS) as BankStatus[]
const SORT_KEYS: SortKey[] = [
  'organisation',
  'programme',
  'round',
  'committed',
  'paid',
  'next',
  'lastPaid',
  'bank',
  'status',
]
/** Text reads best A–Z; money, dates and the two urgency ranks read best worst-first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'round']

export const Route = createFileRoute('/_authenticated/finance/')({
  // Tab, filters and page in the URL: a view you cannot link to is a view you lose
  // every time you open a payment and come back.
  validateSearch: (search: Record<string, unknown>): FinanceSearch => ({
    tab: search.tab === 'paid' ? 'paid' : undefined,
    roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
    programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
    tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
    status: FINANCE_STATUSES.includes(search.status as FinanceStatus)
      ? (search.status as FinanceStatus)
      : undefined,
    bank: BANK_STATUSES.includes(search.bank as BankStatus)
      ? (search.bank as BankStatus)
      : undefined,
    from: typeof search.from === 'string' && ISO_DAY.test(search.from) ? search.from : undefined,
    to: typeof search.to === 'string' && ISO_DAY.test(search.to) ? search.to : undefined,
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
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
  // Two calls in parallel. `getFinanceNav` is only the one flag saying whether Finance
  // offers its second screen — the payments list is built from a round-programme scope and
  // knows nothing of `clientId`, so the tab pair cannot come out of it.
  loader: async ({ deps }) => {
    const [list, nav] = await Promise.all([
      listFinanceGrants({
        data: {
          tab: deps.tab ?? 'to_pay',
          roundId: deps.roundId,
          programmeId: deps.programmeId,
          tag: deps.tag,
          status: deps.status,
          bank: deps.bank,
          from: deps.from,
          to: deps.to,
          q: deps.q,
          sortBy: deps.sortBy,
          sortDir: deps.sortDir,
          page: deps.page,
        },
      }),
      getFinanceNav(),
    ])
    return { ...list, nav }
  },
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
  scheduled: 'var(--color-grey-500)',
  unscheduled: 'var(--color-warning)',
  paid: 'var(--color-success)',
  cancelled: 'var(--color-grey-400)',
}

/**
 * The modulus verdict, coloured by what it means for a payment run. `unchecked` is grey
 * rather than red: it is "we could not run the check" (a sort code or account number of
 * the wrong shape, or a grant written before the verdict was stored), which is not the
 * same claim as "these details are wrong" — and the Attention banner counts it as
 * neither, so the pill must not either.
 */
const BANK_HEX: Record<BankStatus, string> = {
  valid: 'var(--color-success)',
  invalid: 'var(--color-danger)',
  missing: 'var(--color-warning)',
  unchecked: 'var(--color-grey-500)',
}

const txtSub = 'font-display text-body text-grey-500'

// ─── Columns ─────────────────────────────────────────────────────────────────

// Two lines: the grantee, then the foundation's OWN reference for the grant beneath it.
// Finance is the screen where a row is matched against something outside Custodian — a
// ledger, a payment run, an invoice — and the ref is what it is matched ON, so a
// reconciler had to open every grant to read it.
const ORGANISATION: TableColumn<FinanceRow> = {
  id: 'organisation',
  sortable: true,
  header: 'Organisation',
  cell: (g) => (
    <div className="min-w-0">
      <p className="truncate font-display text-body font-medium text-grey-900">
        {g.organisationName}
      </p>
      <p className="truncate font-display text-label" style={{ color: C.sub }}>
        {fmtRef(g.externalApplicationId) ?? '—'}
      </p>
    </div>
  ),
}

const PROGRAMME: TableColumn<FinanceRow> = {
  id: 'programme',
  sortable: true,
  hideBelow: 'lg',
  header: 'Programme',
  width: 'sm:w-[11%]',
  cell: (g) => (
    <TruncatedText
      text={g.programmeName ?? '—'}
      label="Programme"
      className={`font-display text-body ${g.programmeName ? 'text-grey-500' : 'text-grey-400'}`}
    />
  ),
}

// Round and Theme are both filter pills on this screen, so both have to be readable on
// a row: a pill whose effect you cannot see on the rows it left behind is a control that
// appears to do nothing. Theme is not sortable — a grant carrying three of them has no
// place in an ordering.
const ROUND: TableColumn<FinanceRow> = {
  id: 'round',
  sortable: true,
  hideBelow: 'xl',
  header: 'Round',
  width: 'sm:w-[9%]',
  cell: (g) => (
    <TruncatedText
      text={g.roundName ?? '—'}
      label="Round"
      className={`font-display text-body ${g.roundName ? 'text-grey-500' : 'text-grey-400'}`}
    />
  ),
}

const THEME: TableColumn<FinanceRow> = {
  id: 'theme',
  hideBelow: 'xl',
  header: 'Theme',
  width: 'sm:w-[11%]',
  cell: (g) => (
    <TruncatedList
      items={g.tags}
      label="Themes for this grant"
      className={`font-display text-body ${g.tags.length > 0 ? 'text-grey-500' : 'text-grey-400'}`}
    />
  ),
}

const COMMITTED: TableColumn<FinanceRow> = {
  id: 'committed',
  sortable: true,
  header: 'Committed',
  width: 'sm:w-[9%]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <span className="whitespace-nowrap font-display text-body font-medium text-grey-900">
      {fmtMoney(g.committed)}
    </span>
  ),
}

const PAID: TableColumn<FinanceRow> = {
  id: 'paid',
  sortable: true,
  hideBelow: 'lg',
  header: 'Paid',
  width: 'sm:w-[10%]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <div className="whitespace-nowrap">
      <span className={txtSub}>{g.paidToDate > 0 ? fmtMoney(g.paidToDate) : '—'}</span>
      {g.instalmentCount > 0 && (
        <span className="ml-1 font-display text-label text-grey-400">
          {g.paidCount}/{g.instalmentCount}
        </span>
      )}
    </div>
  ),
}

/**
 * Whether the account we would pay into passes the level-1 modulus check — the one
 * question the Bank column (last four digits of an account number) never answered. It
 * keeps the `bank` sort key, so the ordering stays the useful one: the details that
 * would stop a payment going out, first.
 */
const VALID: TableColumn<FinanceRow> = {
  id: 'bank',
  sortable: true,
  hideBelow: 'xl',
  header: 'Valid',
  width: 'sm:w-[9%]',
  cell: (g) => (
    <StatusPill label={BANK_STATUS_LABELS[g.bank.status]} colour={BANK_HEX[g.bank.status]} />
  ),
}

const STATUS: TableColumn<FinanceRow> = {
  id: 'status',
  sortable: true,
  header: 'Status',
  width: 'sm:w-[10%]',
  cell: (g) => <StatusPill label={FINANCE_STATUS_LABELS[g.status]} colour={STATUS_HEX[g.status]} />,
}

const TO_PAY_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  ROUND,
  PROGRAMME,
  THEME,
  COMMITTED,
  PAID,
  {
    id: 'next',
    sortable: true,
    hideBelow: 'sm',
    header: 'Next payment',
    width: 'sm:w-[13%]',
    cellClassName: 'tabular-nums',
    cell: (g) => {
      if (!g.nextPayment) {
        return <span className="font-display text-body text-grey-400">No schedule</span>
      }
      const rel = relativeDays(g.nextPayment.dueDate)
      return (
        <div className="whitespace-nowrap">
          <div className="font-display text-body font-medium text-grey-900">
            {fmtMoney(g.nextPayment.amount)}
          </div>
          <div
            className="font-display text-label"
            style={{ color: rel?.overdue ? 'var(--color-danger)' : 'var(--color-grey-400)' }}
          >
            {g.nextPayment.dueDate
              ? `${fmtDate(g.nextPayment.dueDate)} · ${rel!.text}`
              : 'Date TBC'}
          </div>
        </div>
      )
    },
  },
  VALID,
  STATUS,
]

const PAID_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  ROUND,
  PROGRAMME,
  THEME,
  COMMITTED,
  PAID,
  {
    id: 'lastPaid',
    sortable: true,
    hideBelow: 'sm',
    header: 'Last payment',
    width: 'sm:w-[13%]',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{fmtDate(g.lastPaidDate)}</span>,
  },
  VALID,
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
    nav,
  } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const search = Route.useSearch()
  const {
    tab: tabParam,
    roundId,
    programmeId,
    tag,
    status,
    bank,
    from,
    to,
    q,
    sortBy,
    sortDir,
    page,
  } = search
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
        data: {
          tab,
          roundId,
          programmeId,
          tag,
          status,
          bank,
          from,
          to,
          q,
          sortBy,
          sortDir,
          page: 1,
          pageSize: 10_000,
          // The export is a reconciliation file people take to their bank: it carries
          // the payable details, which the rows on screen deliberately do not.
          includeBankDetails: true,
        },
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
      <FinanceHeader
        tab="payments"
        subtitle={`Grant payments · ${totals.grantCount} live commitment${totals.grantCount === 1 ? '' : 's'}`}
        showTabs={nav.showBalanceAndBudget}
      />

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

        {/* Each pill offers only what this TAB actually contains, with counts — the tab
            is the context these facets are counted over, so switching it re-cuts them.
            Search is the shared row's last item (`ui/FilterRow`) and narrows the table
            and both tab counts, never the KPI strip or the Attention banner above it. */}
        <FilterRow
          search={
            <SearchInput
              value={q}
              onChange={(next) => setFilter({ q: next })}
              placeholder="Search organisation or reference…"
              ariaLabel="Search grants"
            />
          }
        >
          <FilterPill
            label="Status"
            plural="statuses"
            value={status}
            options={facets.statuses.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={(v) => setFilter({ status: (v as FinanceStatus) || undefined })}
          />
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
            onChange={(v) => setFilter({ programmeId: v })}
          />
          <FilterPill
            label="Theme"
            plural="themes"
            value={tag}
            options={facets.themes.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={(v) => setFilter({ tag: v })}
          />
          <FilterPill
            label="Valid"
            plural="bank checks"
            value={bank}
            options={facets.bank.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={(v) => setFilter({ bank: (v as BankStatus) || undefined })}
          />
          {/* The window runs against the date the open tab is about: the next payment due
              on "To pay", the last one made on "Paid". */}
          <DateRangePicker
            value={{ from, to }}
            onChange={(next) => setFilter({ from: next.from, to: next.to })}
            allLabel={tab === 'paid' ? 'Any payment date' : 'Any due date'}
          />
        </FilterRow>

        {rows.length === 0 ? (
          <EmptyState>
            <p className="text-body text-grey-500">
              {status || bank || programmeId || tag || roundId || from || to
                ? 'No grants match these filters.'
                : tab === 'to_pay'
                  ? 'Nothing outstanding — every grant is paid up.'
                  : 'No payments made yet.'}
            </p>
            <p className="mt-1 text-label text-grey-400">
              Grants appear here as soon as an award is generated, with the instalment schedule set
              on the award.
            </p>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-hidden rounded-chip border border-grey-200">
              <DataTable
                columns={tab === 'to_pay' ? TO_PAY_COLUMNS : PAID_COLUMNS}
                rows={rows}
                rowKey={(g) => g.awardId}
                rowClassName={(g) => (opening === g.awardId ? 'opacity-60' : '')}
                onRowClick={(g) => openGrant(g.awardId)}
                // The default order is a real order (soonest owed first), so its
                // column carries the arrow from the moment the screen opens.
                sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : FINANCE_DEFAULT_SORT}
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
 * KPI row that used to sit here. The card itself is shared with Reports (`ui/Horizon`),
 * which wears the same panel over its reporting milestones.
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
      <h2 className="font-display text-title font-medium text-grey-900">Upcoming payments</h2>
      <div className="grid gap-2 lg:grid-cols-3">
        {HORIZONS.map((h) => {
          const bucket: UpcomingBucket = upcoming[h.key]
          return (
            <Horizon
              key={h.key}
              label={h.label}
              colour={h.colour}
              empty={h.empty}
              meta={bucket.count > 0 ? `${fmtMoney(bucket.total)} · ${bucket.count}` : undefined}
              items={bucket.items.map((p, i) => ({
                key: `${p.awardId}-${p.dueDate}-${i}`,
                title: p.organisationName,
                subline: `${p.programmeName ? `${p.programmeName} · ` : ''}Due ${fmtDate(p.dueDate)}`,
                trailing: fmtMoney(p.amount),
                onClick: () => onOpen(p.awardId),
                disabled: opening === p.awardId,
              }))}
              hidden={bucket.count - bucket.items.length}
              hiddenNoun="payment"
            />
          )
        })}
      </div>
    </Card>
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

/** `089999` / `08 99 99` / `08-99-99` all leave as `08-99-99`; anything else, as typed. */
function dashedSortCode(sortCode: string | null | undefined): string {
  if (!sortCode) return ''
  const digits = sortCode.replace(/\D/g, '')
  return digits.length === 6 ? digits.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3') : sortCode
}

/**
 * A payment export of the current tab — the figures on screen, as a spreadsheet, with
 * the details each payment would be made against: account name, sort code, account
 * number.
 *
 * It used to carry the masked account (last four) only, on the reasoning that a file
 * which cannot be paid from is a file that can be shared freely. That made it the wrong
 * file for the job it is actually used for: a finance officer reconciling a payment run
 * against their bank, who then had to open every grant to copy the numbers out one at a
 * time. Whoever can press this button can already read the same details in the payment
 * dialog, so this is not a new disclosure — but the file IS now payable, so treat it as
 * one.
 *
 * The sort code is written **dashed** (`08-99-99`) rather than as six digits. Quoting a
 * CSV field does not stop a spreadsheet reading it as a number, and `089999` opened in
 * Excel is `89999` — a sort code that has silently lost its first digit. The dashes are
 * also how a bank asks for it. (An account number beginning with a zero has the same
 * hazard and no such convention to hide behind; it is exported as stored, so check one
 * against the app if a payment file is being built from this.)
 *
 * `bankName` is deliberately absent: the sort code is what identifies the bank, and the
 * name is the one bank field no feature reads (see the canonical tiers).
 */
function exportCsv(rows: FinanceRow[], tab: Tab) {
  const header = [
    'Organisation',
    // The foundation's own reference, second: this file exists to be reconciled against
    // their ledger, and the ref is the column the two are joined on.
    'Reference',
    'Programme',
    'Round',
    'Theme',
    'Committed',
    'Paid to date',
    'Outstanding',
    'Instalments paid',
    'Next payment',
    'Next payment due',
    'Last paid',
    'Status',
    'Account name',
    'Sort code',
    'Account number',
    'Valid',
  ]
  const body = rows.map((g) => [
    g.organisationName,
    g.externalApplicationId ?? '',
    g.programmeName ?? '',
    g.roundName ?? '',
    g.tags.join('; '),
    g.committed,
    g.paidToDate,
    g.outstanding,
    `${g.paidCount}/${g.instalmentCount}`,
    g.nextPayment?.amount ?? '',
    g.nextPayment?.dueDate ?? '',
    g.lastPaidDate ?? '',
    FINANCE_STATUS_LABELS[g.status],
    g.bank.accountName ?? '',
    dashedSortCode(g.bank.sortCode),
    g.bank.accountNumber ?? '',
    BANK_STATUS_LABELS[g.bank.status],
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
