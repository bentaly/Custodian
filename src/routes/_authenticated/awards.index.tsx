import { createFileRoute, Link } from '@tanstack/react-router'
import { BankIcon, Calendar03Icon, Coins01Icon, Target01Icon } from '@hugeicons/core-free-icons'
import {
  DataTable,
  DateRangePicker,
  EmptyState,
  FilterPill,
  KPI_TINTS,
  MiniKpi,
  Pagination,
  SearchInput,
  SelectPill,
  StatusPill,
  type TableColumn,
} from '../../components/ui'
import { listAwards, GRANT_STATUS_LABELS } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { facetLabel } from '../../lib/facets'
import { C } from '../../components/ui/tokens'
import { getRoundStatus } from '../../lib/roundStatus'
import { fmtCompact, fmtDate, fmtMoney } from '../../lib/format'

type AwardItem = ReturnType<typeof Route.useLoaderData>['items'][number]

type AwardStatus = 'active' | 'completed' | 'cancelled'

type SortKey =
  | 'organisation'
  | 'programme'
  | 'round'
  | 'awarded'
  | 'amount'
  | 'paid'
  | 'duration'
  | 'geography'
  | 'status'
type SortDir = 'asc' | 'desc'

type AwardsSearch = {
  roundId?: string
  programmeId?: string
  tag?: string
  status?: AwardStatus
  q?: string
  from?: string
  to?: string
  sortBy?: SortKey
  sortDir?: SortDir
  page?: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const AWARD_STATUSES: AwardStatus[] = ['active', 'completed', 'cancelled']
const SORT_KEYS: SortKey[] = [
  'organisation',
  'programme',
  'round',
  'awarded',
  'amount',
  'paid',
  'duration',
  'geography',
  'status',
]
/** Text reads best A–Z; money, dates and counts read best biggest/newest first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'round', 'geography', 'status']

export const Route = createFileRoute('/_authenticated/awards/')({
  validateSearch: (search: Record<string, unknown>): AwardsSearch => ({
    roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
    programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
    tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
    status: AWARD_STATUSES.includes(search.status as AwardStatus)
      ? (search.status as AwardStatus)
      : undefined,
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
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
    roundId: search.roundId,
    programmeId: search.programmeId,
    tag: search.tag,
    status: search.status,
    q: search.q,
    from: search.from,
    to: search.to,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    // The filter options come back with the data (`facets`) — see `src/lib/facets.ts`.
    // Nothing here has to know what programmes or themes exist; the awards say so.
    const [awardsData, rounds] = await Promise.all([
      listAwards({
        data: {
          roundId: deps.roundId,
          programmeId: deps.programmeId,
          tag: deps.tag,
          status: deps.status,
          q: deps.q,
          from: deps.from,
          to: deps.to,
          sortBy: deps.sortBy,
          sortDir: deps.sortDir,
          page: deps.page,
        },
      }),
      listMyRounds(),
    ])
    return { ...awardsData, rounds }
  },
  component: AwardsPage,
})

const GRANT_STATUS_HEX: Record<string, string> = {
  active: C.success,
  completed: C.sub,
  cancelled: C.danger,
}

const txtInk = 'font-display text-body text-grey-900'
const txtSub = 'font-display text-body text-grey-500'

const AWARD_COLUMNS: TableColumn<AwardItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    cell: (g) => (
      <Link
        to="/awards/$awardId"
        params={{ awardId: g.awardId }}
        onClick={(e) => e.stopPropagation()}
        className="font-display text-body font-medium text-grey-900 hover:underline"
      >
        {g.organisationName}
      </Link>
    ),
  },
  {
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    cell: (g) => <span className={txtSub}>{g.programmeName ?? '—'}</span>,
  },
  {
    id: 'round',
    sortable: true,
    hideBelow: 'xl',
    header: 'Round',
    cell: (g) => <span className={txtSub}>{g.roundName ?? '—'}</span>,
  },
  {
    id: 'awarded',
    sortable: true,
    hideBelow: 'lg',
    header: 'Awarded',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{fmtDate(g.decisionAt)}</span>,
  },
  {
    id: 'amount',
    sortable: true,
    header: 'Amount',
    cellClassName: 'tabular-nums',
    cell: (g) => (
      <span className="whitespace-nowrap font-display text-body font-medium text-grey-900">
        {fmtMoney(g.amountAwarded)}
      </span>
    ),
  },
  {
    id: 'paid',
    sortable: true,
    hideBelow: 'md',
    header: 'Paid',
    cell: (g) =>
      g.instalmentCount === 0 ? (
        <span className={txtSub}>—</span>
      ) : (
        <span
          className={`whitespace-nowrap ${txtSub}`}
          title={`${g.paidCount} of ${g.instalmentCount} instalments paid`}
        >
          {fmtCompact(g.paidToDate)} <span className="text-grey-400">/ {g.instalmentCount}</span>
        </span>
      ),
  },
  {
    id: 'duration',
    sortable: true,
    hideBelow: 'xl',
    header: 'Duration',
    cell: (g) => (
      <span className={`whitespace-nowrap ${txtSub}`}>
        {g.durationYears ? `${g.durationYears} yr${g.durationYears > 1 ? 's' : ''}` : '—'}
      </span>
    ),
  },
  {
    id: 'geography',
    sortable: true,
    hideBelow: 'xl',
    header: 'Geography',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{g.deliveryArea ?? '—'}</span>,
  },
  {
    id: 'status',
    sortable: true,
    header: 'Status',
    width: 'sm:w-[120px]',
    cell: (g) => (
      <StatusPill
        label={GRANT_STATUS_LABELS[g.status] ?? g.status}
        colour={GRANT_STATUS_HEX[g.status] ?? C.sub}
      />
    ),
  },
]

type ProgrammeShare = { name: string; amount: number }
type Totals = ReturnType<typeof Route.useLoaderData>['totals']

function StatCards({ totals }: { totals: Totals }) {
  const top: ProgrammeShare[] = totals.byProgramme.slice(0, 3)
  const topTotal = top.reduce((s: number, p: ProgrammeShare) => s + p.amount, 0)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MiniKpi
        tint={KPI_TINTS.violet}
        icon={Coins01Icon}
        label="Total awarded"
        value={fmtMoney(totals.totalAwarded)}
        sub={`${totals.count} award${totals.count !== 1 ? 's' : ''}`}
      />
      <MiniKpi
        tint={KPI_TINTS.green}
        icon={BankIcon}
        label="Paid to date"
        value={fmtMoney(totals.paidToDate)}
        sub={`${fmtMoney(totals.outstanding)} outstanding`}
      />
      <MiniKpi
        tint={KPI_TINTS.amber}
        icon={Calendar03Icon}
        label="Multi-year"
        value={String(totals.multiYearCount)}
        sub="awards running over 1 year"
      />
      <MiniKpi
        tint={KPI_TINTS.pink}
        icon={Target01Icon}
        label="By programme"
        value={top[0] ? top[0].name : '—'}
        sub={top[0] ? `${fmtCompact(top[0].amount)} · largest share` : 'no awards yet'}
      >
        {top.length > 0 && (
          <div className="mt-3 space-y-1">
            {top.map((p: ProgrammeShare) => {
              const pct = topTotal > 0 ? Math.round((p.amount / topTotal) * 100) : 0
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-label">
                    <span className="truncate text-grey-500" title={p.name}>
                      {p.name}
                    </span>
                    <span className="ml-2 shrink-0 font-medium text-grey-700">
                      {fmtCompact(p.amount)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/70">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: KPI_TINTS.pink.accent }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </MiniKpi>
    </div>
  )
}

function AwardsPage() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const { roundId, programmeId, tag, status, q, from, to, sortBy, sortDir, page } = search
  const { items, total, pageSize, totals, rounds, facets } = Route.useLoaderData()
  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
      const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
      return bT - aT
    })

  const selectedRound = rounds.find((r) => r.id === roundId)

  // Unlike the round-scoped screens this one starts across every round — a grants
  // portfolio is the whole book of business, not one sitting's decisions — so the pill
  // keeps an "All rounds" option rather than using `RoundSelect`, which has none.
  const roundStatus = selectedRound ? getRoundStatus(selectedRound) : null
  const metaLine = [
    `${totals.count} award${totals.count !== 1 ? 's' : ''}`,
    roundStatus === 'open' ? 'current round' : roundStatus === 'closed' ? 'closed' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  function handleRoundChange(nextRoundId: string) {
    navigate({
      search: (prev) => ({
        ...prev,
        roundId: nextRoundId || undefined,
        programmeId: undefined,
        tag: undefined,
        page: undefined,
      }),
    })
  }

  // Every filter change returns to page 1 — page 4 of the old result set is a different
  // set of awards, and landing there silently is disorienting.
  function setProgramme(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, programmeId: id, page: undefined }) })
  }

  function setTag(value: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, tag: value, page: undefined }) })
  }

  function setStatus(value: string | undefined) {
    navigate({
      search: (prev) => ({ ...prev, status: (value as AwardStatus) || undefined, page: undefined }),
    })
  }

  // First click sorts by the column's natural direction; clicking the active column
  // flips it. Same behaviour as the applications table.
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

  function goToPage(p: number) {
    navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header — <h1>, then the round pill and the list's meta on the row beneath, as
          on Applications. */}
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-heading font-medium text-grey-900">Awards</h1>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {visibleRounds.length > 0 && (
              <SelectPill
                ariaLabel="Select round"
                icon={Calendar03Icon}
                options={visibleRounds.map((r) => ({ value: r.id, label: r.name }))}
                value={roundId}
                clearLabel="All rounds"
                onChange={handleRoundChange}
              />
            )}
            <span className="whitespace-nowrap font-display text-label font-medium text-grey-500">
              {metaLine}
            </span>
          </div>
          <SearchInput
            value={q}
            onChange={(next) =>
              navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }) })
            }
            placeholder="Search organisation…"
          />
        </div>
      </div>

      <StatCards totals={totals} />

      {/* Filters — the same row every list screen wears, in the shared order. Each pill
          offers only what the awards in view actually contain, with counts, and stays in
          place when that is one value or none (see `ui/FilterPill`). */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterPill
          label="Status"
          plural="statuses"
          value={status}
          options={facets.statuses.map((f) => ({ value: f.value, label: facetLabel(f) }))}
          onChange={setStatus}
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
          onChange={setTag}
        />
        <DateRangePicker
          value={{ from, to }}
          onChange={(next) =>
            navigate({
              search: (prev) => ({ ...prev, from: next.from, to: next.to, page: undefined }),
            })
          }
          allLabel="Any award date"
        />
      </div>

      {items.length === 0 ? (
        <EmptyState>
          <p className="text-body text-grey-500">No awards match these filters.</p>
          <p className="mt-1 text-label text-grey-400">
            Awards appear here as soon as one is generated after the trustee vote.
          </p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-card border border-grey-200 bg-white">
            <DataTable
              columns={AWARD_COLUMNS}
              rows={items}
              rowKey={(g) => g.awardId}
              onRowClick={(g) =>
                navigate({ to: '/awards/$awardId', params: { awardId: g.awardId } })
              }
              sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : undefined}
              onSort={setSort}
            />
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            shown={items.length}
            total={total}
            noun="awards"
            onChange={goToPage}
          />
        </div>
      )}
    </div>
  )
}
