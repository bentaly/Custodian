import { useEffect, useState } from 'react'
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
import { FinanceHeader } from '../../components/finance/FinanceHeader'
import { MarkPaidDialog } from '../../components/finance/MarkPaidDialog'
import {
  Card,
  DataTable,
  DateRangePicker,
  EmptyState,
  ExportMenu,
  FilterPill,
  FilterRow,
  OrganisationCell,
  SearchInput,
  Horizon,
  Button,
  Pagination,
  StatusPill,
  Tabs,
  TruncatedList,
  TruncatedText,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { facetLabel } from '../../lib/facets'
import { oneOfList, textList } from '../../lib/listSearch'
import { messageFor } from '../../lib/errors'
import { fmtDate, fmtMoney, fmtRef } from '../../lib/format'
import { DUE_SOON_DAYS } from '../../lib/schedule'
import { downloadTable, type ExportColumn, type ExportFormat } from '../../lib/spreadsheetExport'

// Derived from the server fn rather than the route loader: `Route.useLoaderData` is
// circular here (the route's component uses these types), which resolves to `any`.
type FinanceData = Awaited<ReturnType<typeof listFinanceGrants>>
type FinanceRow = FinanceData['items'][number]
type Totals = FinanceData['totals']

type SortKey =
  | 'organisation'
  | 'programme'
  | 'round'
  | 'amount'
  | 'grant'
  | 'due'
  | 'paid'
  | 'bank'
  | 'status'
type SortDir = 'asc' | 'desc'

type FinanceSearch = {
  tab?: 'paid'
  roundId?: string[]
  programmeId?: string[]
  tag?: string[]
  status?: FinanceStatus[]
  bank?: BankStatus[]
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
  'amount',
  'grant',
  'due',
  'paid',
  'bank',
  'status',
]
/**
 * Text reads best A–Z; money and the two urgency ranks read best worst-first.
 *
 * `due` joins the A–Z half, which the old `next` did not have to think about: on a list
 * of payments the first click on the Due column has to mean "soonest first". Descending
 * would open the payment run on the money furthest away.
 */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'round', 'due']

export const Route = createFileRoute('/_authenticated/finance/')({
  // Tab, filters and page in the URL: a view you cannot link to is a view you lose
  // every time you open a payment and come back.
  validateSearch: (search: Record<string, unknown>): FinanceSearch => ({
    tab: search.tab === 'paid' ? 'paid' : undefined,
    // Every pill takes several values — see `lib/listSearch`'s `textList`.
    roundId: textList(search.roundId),
    programmeId: textList(search.programmeId),
    tag: textList(search.tag),
    status: oneOfList(FINANCE_STATUSES, search.status),
    bank: oneOfList(BANK_STATUSES, search.bank),
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
  loader: async ({ deps }) =>
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
  component: FinancePage,
})

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * "in 4 days" / "12 days ago" — the thing a finance officer actually reads off a due
 * date, and `null` where the date says it better on its own.
 *
 * A countdown is only worth reading while it is actionable. Beyond a month out nobody
 * pays anything off "in 128 days" — the date is the fact, the countdown is noise
 * dressed as precision, and it pushed a second line of grey under every scheduled row
 * that no payment run would touch this quarter. The horizon is `DUE_SOON_DAYS` itself,
 * imported rather than a 30 of its own: inside it a payment is one this screen already
 * calls due soon, outside it it is a date in the diary.
 *
 * The past is NOT capped. An overdue payment is a payment somebody has to chase, and
 * how long it has been overdue is the whole point of saying it — a year late is more
 * urgent than a week late, not less.
 */
function relativeDays(iso: string | null): { text: string | null; overdue: boolean } | null {
  if (!iso) return null
  const today = new Date().toISOString().slice(0, 10)
  const days = Math.round(
    (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  )
  if (days === 0) return { text: 'today', overdue: false }
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} ago`, overdue: true }
  if (days > DUE_SOON_DAYS) return { text: null, overdue: false }
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

/**
 * Two lines: the grantee, then WHICH PAYMENT this is and the foundation's own reference.
 *
 * Finance is the screen where a row is matched against something outside Custodian — a
 * ledger, a payment run, an invoice — and the ref is what it is matched ON, so a
 * reconciler had to open every grant to read it.
 *
 * "Payment 2 of 2" is what stops a charity's two rows reading as a duplicated row.
 * `DataTable` has no row grouping and this deliberately does not add any: repeating the
 * organisation on every one of its payments is right for a list you scan for a name,
 * and the subline is where the row says which of them it is. A grant with a single
 * instalment says nothing — "Payment 1 of 1" is noise on the common case.
 */
function paymentLabel(g: FinanceRow): string | null {
  if (g.instalmentId === null) return 'No payment planned'
  if (g.instalmentCount <= 1 || g.instalmentNo === null) return null
  return `Payment ${g.instalmentNo} of ${g.instalmentCount}`
}

const ORGANISATION: TableColumn<FinanceRow> = {
  id: 'organisation',
  sortable: true,
  header: 'Organisation',
  cell: (g) => {
    const subline = [paymentLabel(g), fmtRef(g.externalApplicationId)].filter(Boolean).join(' · ')
    // No link: a row here opens the payment dialog, so the whole row is the target.
    return <OrganisationCell name={g.organisationName} subline={subline} imported={g.imported} />
  },
}

const PROGRAMME: TableColumn<FinanceRow> = {
  id: 'programme',
  sortable: true,
  hideBelow: 'lg',
  header: 'Programme',
  width: 'sm:w-[11%]',
  cell: (g) => (
    <TruncatedText
      text={g.programmeName ?? '--'}
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
      text={g.roundName ?? '--'}
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

/**
 * THIS payment's money, and the row's headline figure — because on a payment run the
 * question is what leaves the account, not what the grant was worth.
 *
 * On the unscheduled row it is what the grant still owes. That row has no instalment
 * to state, and the amount is the whole point of showing it: money promised with no
 * plan to pay it.
 */
const AMOUNT: TableColumn<FinanceRow> = {
  id: 'amount',
  sortable: true,
  header: 'Amount',
  width: 'sm:w-[9%]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <span className="whitespace-nowrap font-display text-body font-medium text-grey-900">
      {fmtMoney(g.amount)}
    </span>
  ),
}

/**
 * The grant this payment belongs to: its total, and how far through the schedule it is.
 *
 * Context, not the headline — which is exactly the change this screen needed. Two rows
 * of £9,730 both showing £19,460 in the money column read as £38,920 at a glance; here
 * the figure is subdued, labelled Grant, and paired with "1/2 paid" so it answers the
 * question the payment row raises ("what else is owed on this?") rather than competing
 * with it.
 *
 * `Awarded` is the word the rest of the app uses for one grant's money (the Awards
 * register's Amount column, an award screen's Awarded fact); "Committed" is the word for
 * the ROLLUP — the budget panel's bar, the wizard's total, the header's "live
 * commitments". The header here says **Grant** because on this screen the contrast that
 * matters is not awarded-versus-committed, it is this payment versus the whole grant.
 */
const GRANT: TableColumn<FinanceRow> = {
  id: 'grant',
  sortable: true,
  hideBelow: 'lg',
  header: 'Grant',
  width: 'sm:w-[10%]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <div className="whitespace-nowrap">
      <span className={txtSub}>{fmtMoney(g.committed)}</span>
      {g.instalmentCount > 0 && (
        <span className="ml-1 font-display text-label text-grey-400">
          {g.paidCount}/{g.instalmentCount} paid
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

/**
 * When this payment is due, and how far off that is.
 *
 * Three states, all of them a real answer rather than a blank: a date, "Date TBC" for an
 * instalment nobody dated, and "No schedule" for the grant that has no instalments at
 * all. The last is the row the LEFT JOIN exists for — see `paymentsQuery`.
 */
const DUE: TableColumn<FinanceRow> = {
  id: 'due',
  sortable: true,
  hideBelow: 'sm',
  header: 'Due',
  width: 'sm:w-[12%]',
  cellClassName: 'tabular-nums',
  cell: (g) => {
    if (g.instalmentId === null) {
      return <span className="font-display text-body text-grey-400">No schedule</span>
    }
    if (!g.dueDate) return <span className="font-display text-body text-grey-400">Date TBC</span>
    const rel = relativeDays(g.dueDate)
    return (
      <div className="whitespace-nowrap">
        <div className="font-display text-body text-grey-900">{fmtDate(g.dueDate)}</div>
        {rel?.text && (
          <div
            className="font-display text-label"
            style={{ color: rel.overdue ? 'var(--color-danger)' : 'var(--color-grey-400)' }}
          >
            {rel.text}
          </div>
        )}
      </div>
    )
  },
}

const TO_PAY_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  ROUND,
  PROGRAMME,
  THEME,
  AMOUNT,
  DUE,
  GRANT,
  VALID,
  STATUS,
]

const PAID_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  ROUND,
  PROGRAMME,
  THEME,
  AMOUNT,
  {
    id: 'paid',
    sortable: true,
    hideBelow: 'sm',
    header: 'Paid on',
    width: 'sm:w-[12%]',
    cellClassName: 'tabular-nums',
    // A cancelled grant's unpaid instalments sit on this tab too — nothing left to pay —
    // and they have no date, which is the honest answer rather than a borrowed one.
    cell: (g) => (
      <span
        className={`whitespace-nowrap ${g.paidDate ? txtSub : 'font-display text-body text-grey-400'}`}
      >
        {g.paidDate ? fmtDate(g.paidDate) : '--'}
      </span>
    ),
  },
  GRANT,
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
  const { user } = Route.useRouteContext()

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const [error, setError] = useState('')

  // The payment panel is a dialog over this list, not a route: the schedule is a handful
  // of rows, and a finance officer working a payment run wants the list still behind it.
  // Like the round dialog, the grant's own detail is fetched on open rather than carried
  // on every row.
  const [grant, setGrant] = useState<FinanceGrant | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  // The payment the dialog was opened FROM. A list row is one payment but the dialog is
  // the whole grant's schedule, so without this a grant of four instalments opens on four
  // rows and nothing says which of them was clicked.
  const [focusInstalmentId, setFocusInstalmentId] = useState<string | null>(null)

  async function openGrant(awardId: string, instalmentId: string | null) {
    setError('')
    setOpening(awardId)
    try {
      setGrant(await getFinanceGrant({ data: { id: awardId } }))
      setFocusInstalmentId(instalmentId)
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

  // Row selection for the bulk "Mark as paid". Only on To pay, and only for the roles
  // the server lets pay (`setInstalmentsPaid`): a trustee gets no checkbox column at all
  // rather than a selection that can only end in "You do not have access to that".
  // Scoped to the page on screen, like Applications, and cleared whenever the list under
  // it changes: a selection carried onto rows nobody can see is a payment run nobody
  // checked.
  const canPay = ['superadmin', 'admin', 'finance'].includes(user.role) && tab === 'to_pay'
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [marking, setMarking] = useState(false)
  useEffect(() => {
    setSelected(new Set())
  }, [tab, roundId, programmeId, tag, status, bank, from, to, q, sortBy, sortDir, page])

  // A grant with no schedule has no payment to mark; `instalmentId` is null only there.
  const selectable = rows.filter(
    (r): r is FinanceRow & { instalmentId: string } => r.instalmentId !== null && !r.paidDate,
  )
  const selectedRows = selectable.filter((r) => selected.has(r.instalmentId))
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0)
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.instalmentId))
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.instalmentId)))
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
        ...(prev.sortBy === 'due' || prev.sortBy === 'paid'
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
  async function handleExport(format: ExportFormat) {
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
      await exportPayments(all.items, tab, format)
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
          <ExportMenu onExport={handleExport} busy={exporting} disabled={rows.length === 0} />
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
            onChange={(v) => setFilter({ status: v as FinanceStatus[] | undefined })}
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
            onChange={(v) => setFilter({ bank: v as BankStatus[] | undefined })}
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
                ? 'No payments match these filters.'
                : tab === 'to_pay'
                  ? 'Nothing outstanding. Every grant is paid up.'
                  : 'No payments made yet.'}
            </p>
            <p className="mt-1 text-label text-grey-400">
              Payments appear here as soon as an award is generated, one row per instalment of the
              schedule set on the award.
            </p>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-hidden rounded-chip border border-grey-200">
              <DataTable
                columns={tab === 'to_pay' ? TO_PAY_COLUMNS : PAID_COLUMNS}
                rows={rows}
                // The payment, not the grant — a grant now has as many rows as it has
                // instalments, and keying on the award would collide them.
                rowKey={(g) => g.key}
                rowClassName={(g) => (opening === g.awardId ? 'opacity-60' : '')}
                onRowClick={(g) => openGrant(g.awardId, g.instalmentId)}
                // The default order is a real order (soonest owed first on To pay,
                // most recently paid first on Paid), so its column carries the arrow
                // from the moment the screen opens.
                sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : FINANCE_DEFAULT_SORT[tab]}
                onSort={setSort}
                selection={
                  canPay
                    ? {
                        isSelectable: (g) => g.instalmentId !== null && !g.paidDate,
                        isSelected: (g) => g.instalmentId !== null && selected.has(g.instalmentId),
                        toggle: (g) => g.instalmentId && toggleOne(g.instalmentId),
                        allSelected,
                        someSelected: selectedRows.length > 0,
                        toggleAll,
                      }
                    : undefined
                }
              />
            </div>

            {/* Selection bar, under the table beside the rows it acts on: the same dark
                bar Applications uses, so selecting rows reads the same app-wide. */}
            {canPay && selectedRows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-chip bg-grey-900 p-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-chip bg-white/10 px-2 font-display text-body font-medium text-white"
                  >
                    Clear
                  </button>
                  <span className="font-display text-label font-medium text-brand-light">
                    {selectedRows.length} selected · {fmtMoney(selectedTotal)}
                  </span>
                </div>
                <Button variant="primary" size="sm" onClick={() => setMarking(true)}>
                  Mark as paid
                </Button>
              </div>
            )}
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              shown={rows.length}
              total={total}
              noun="payments"
              onChange={(p) =>
                navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
              }
            />
          </>
        )}
      </Card>

      {marking && selectedRows.length > 0 && (
        <MarkPaidDialog
          payments={selectedRows.map((r) => ({
            instalmentId: r.instalmentId,
            organisationName: r.organisationName,
            instalmentNo: r.instalmentNo,
            instalmentCount: r.instalmentCount,
            amount: r.amount,
            dueDate: r.dueDate,
            bankStatus: r.bank.status,
          }))}
          onClose={() => setMarking(false)}
          onDone={async () => {
            setMarking(false)
            setSelected(new Set())
            await router.invalidate()
          }}
        />
      )}

      {grant && (
        <PaymentDialog
          grant={grant}
          focusInstalmentId={focusInstalmentId}
          onClose={() => setGrant(null)}
          onChanged={refreshGrant}
        />
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
  onOpen: (awardId: string, instalmentId: string) => void
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
                onClick: () => onOpen(p.awardId, p.instalmentId),
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
 * number. One column list feeds both formats (`lib/spreadsheetExport`).
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
 * also how a bank asks for it. An account number beginning with a zero has the same
 * hazard in the CSV and no such convention to hide behind, which is what the Excel
 * format is for: there every bank field is a text cell and keeps its zeros.
 *
 * `bankName` is deliberately absent: the sort code is what identifies the bank, and the
 * name is the one bank field no feature reads (see the canonical tiers).
 */
const EXPORT_COLUMNS: ExportColumn<FinanceRow>[] = [
  { header: 'Organisation', width: 32, value: (g) => g.organisationName },
  // The foundation's own reference, second: this file exists to be reconciled against
  // their ledger, and the ref is the column the two are joined on.
  { header: 'Reference', width: 16, value: (g) => g.externalApplicationId },
  { header: 'Programme', width: 24, value: (g) => g.programmeName },
  { header: 'Round', width: 20, value: (g) => g.roundName },
  { header: 'Theme', width: 24, value: (g) => g.tags.join('; ') },
  // The payment itself, which is now what a row IS — so the file is a payment file
  // rather than a grant summary with a next-payment column bolted to the side. One
  // line per payment is also the shape a bank's own upload templates take.
  {
    header: 'Payment',
    value: (g) =>
      g.instalmentId === null
        ? 'No schedule'
        : g.instalmentNo !== null
          ? `${g.instalmentNo} of ${g.instalmentCount}`
          : '',
  },
  { header: 'Payment amount', kind: 'money', width: 16, value: (g) => g.amount },
  { header: 'Due date', kind: 'date', value: (g) => g.dueDate },
  { header: 'Paid date', kind: 'date', value: (g) => g.paidDate },
  { header: 'Status', width: 14, value: (g) => FINANCE_STATUS_LABELS[g.status] },
  // The grant behind it, so a row still reconciles against a ledger kept per grant.
  { header: 'Grant total', kind: 'money', width: 14, value: (g) => g.committed },
  { header: 'Paid to date', kind: 'money', width: 14, value: (g) => g.paidToDate },
  // "To pay", the foundation's own word for it, matching the tab it is exported from.
  { header: 'To pay', kind: 'money', width: 14, value: (g) => g.outstanding },
  { header: 'Instalments paid', value: (g) => `${g.paidCount}/${g.instalmentCount}` },
  { header: 'Account name', width: 28, value: (g) => g.bank.accountName },
  { header: 'Sort code', value: (g) => dashedSortCode(g.bank.sortCode) },
  { header: 'Account number', width: 16, value: (g) => g.bank.accountNumber },
  { header: 'Valid', value: (g) => BANK_STATUS_LABELS[g.bank.status] },
]

function exportPayments(rows: FinanceRow[], tab: Tab, format: ExportFormat) {
  return downloadTable({
    format,
    columns: EXPORT_COLUMNS,
    rows,
    filename: `custodian-finance-${tab === 'to_pay' ? 'to-pay' : 'paid'}-${new Date().toISOString().slice(0, 10)}`,
    sheetName: tab === 'to_pay' ? 'To pay' : 'Paid',
  })
}
