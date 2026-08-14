import { createFileRoute, Link } from '@tanstack/react-router'
import {
  DataTable,
  DateRangePicker,
  EmptyState,
  FilterPill,
  Pagination,
  SearchInput,
  StatusPill,
  initials,
  type TableColumn,
} from '../../components/ui'
import { BarMeter } from '../../components/BarMeter'
import { ProgressBar } from '../../components/ProgressBar'
import { listAwards, GRANT_STATUS_LABELS } from '../../server/fns/applications'
import { facetLabel } from '../../lib/facets'
import { C } from '../../components/ui/tokens'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { fmtCompact, fmtDate, fmtMoney } from '../../lib/format'

type AwardItem = ReturnType<typeof Route.useLoaderData>['items'][number]

type AwardStatus = 'active' | 'completed' | 'cancelled'

// No 'status' key: the lifecycle pill moved into the Paid column, and sorting by a
// column that no longer has a header is unreachable. Status is still a FILTER — the
// server keeps accepting the old key, so a stale bookmarked URL degrades to the
// default order rather than erroring.
type SortKey = 'organisation' | 'programme' | 'awarded' | 'amount' | 'paid' | 'duration'
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
const SORT_KEYS: SortKey[] = ['organisation', 'programme', 'awarded', 'amount', 'paid', 'duration']
/** Text reads best A–Z; money, dates and counts read best biggest/newest first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme']

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
  loader: async ({ deps }) =>
    // The filter options come back with the data (`facets`) — see `src/lib/facets.ts`.
    // Nothing here has to know what programmes, themes or rounds exist; the awards say
    // so. That is also why there is no separate `listMyRounds` call: it existed to fill
    // the round pill in the header, and a facet of the rounds actually represented here
    // is strictly better — it cannot offer a round with no awards in it.
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
  component: AwardsPage,
})

const GRANT_STATUS_HEX: Record<string, string> = {
  active: C.success,
  completed: C.sub,
  cancelled: C.danger,
}

const txtSub = 'font-display text-body text-grey-500'

const AWARD_COLUMNS: TableColumn<AwardItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    // Monogram + two-line identity, as on Applications. The subline is what identifies a
    // grantee at a glance without opening the row — where they work and which sitting
    // funded them.
    //
    // Round and Geography have no columns of their own precisely because they live here.
    // Carrying both was straightforwardly duplication: the same two strings twice on
    // every row, once in the subline and once out at the right-hand edge. Folding them in
    // is also what makes the pattern fit — Applications has no Geography column for the
    // same reason. Their sort keys went with them; both are still reachable, round as a
    // filter pill and geography through search.
    cell: (g) => {
      const subline = [g.deliveryArea, g.roundName].filter(Boolean).join(' · ') || '—'
      return (
        <div className="flex items-center gap-2">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-chip"
            style={{ backgroundColor: C.wash }}
          >
            <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
              {initials(g.organisationName)}
            </span>
          </div>
          <div className="min-w-0">
            <Link
              to="/awards/$awardId"
              params={{ awardId: g.awardId }}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-display text-body font-medium hover:underline"
              style={{ color: C.ink }}
            >
              {g.organisationName}
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
    cell: (g) => <span className={txtSub}>{g.programmeName ?? '—'}</span>,
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
    width: 'sm:w-[190px]',
    // This used to read "£22k / 3" — paid money over an instalment COUNT, two different
    // units either side of a slash, which is why it read as nonsense. It now answers the
    // question the column is actually for: how far through paying this grant are we.
    //
    // The lifecycle pill lives here rather than in a column of its own because it is a
    // statement ABOUT this progress and nothing else: `awards.status` is re-derived from
    // the instalments on every payment (`markInstalmentPaid`), so "Done" means precisely
    // "the bar is full". Standing alone it read as a second, independent fact.
    cell: (g) => {
      const pill = (
        <StatusPill
          label={GRANT_STATUS_LABELS[g.status] ?? g.status}
          colour={GRANT_STATUS_HEX[g.status] ?? C.sub}
        />
      )
      // No schedule set up yet: there is no progress to draw, and a 0% bar would claim
      // nothing has been paid rather than that nothing has been planned.
      if (g.instalmentCount === 0) {
        return (
          <div className="flex items-center gap-2">
            <span className={txtSub}>No schedule</span>
            {pill}
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="whitespace-nowrap font-display text-body tabular-nums text-grey-700">
              <span className="font-medium text-grey-900">{fmtCompact(g.paidToDate)}</span> of{' '}
              {fmtCompact(g.amountAwarded)}
            </span>
            {pill}
          </div>
          <ProgressBar
            value={g.amountAwarded > 0 ? g.paidToDate / g.amountAwarded : 0}
            colour={g.status === 'cancelled' ? C.muted : C.success}
            height={4}
            animate={false}
          />
          <span className="whitespace-nowrap font-display text-label text-grey-500">
            {g.paidCount} of {g.instalmentCount} instalment{g.instalmentCount === 1 ? '' : 's'}
          </span>
        </div>
      )
    },
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
]

// From the server fn, not the route loader: `Route.useLoaderData` is circular here
// (the route's component uses this type), which resolves to `any` — and an `any` here
// would silently un-type every share in the bar below.
type Totals = Awaited<ReturnType<typeof listAwards>>['totals']

/**
 * Where the portfolio's money actually went, in one bar.
 *
 * This replaces the four KPI tiles that used to sit here, following the move the
 * designer made on Finance (Figma 665:25047), where a KPI row became a panel that NAMES
 * things rather than only totalling them. "£1.2m awarded" is a number you read once;
 * "Environment & Nature is two-thirds of the book" is the thing a trustee actually asks.
 * The headline totals didn't disappear — they moved into the header meta line, where
 * they read as a description of the list rather than four cards competing with it.
 *
 * Segments are the programmes' own colours, so the bar is read in the same vocabulary as
 * the programme cards and the round budgets. Beyond six programmes the tail is pooled
 * into one neutral "other" segment: past that the slices are too thin to point at, and a
 * legend nobody can match to the bar is decoration.
 */
const MAX_SEGMENTS = 6

function PortfolioCard({ totals }: { totals: Totals }) {
  const shares = totals.byProgramme
  const head = shares.slice(0, MAX_SEGMENTS)
  const tail = shares.slice(MAX_SEGMENTS)
  const tailAmount = tail.reduce((s, p) => s + p.amount, 0)

  const segments = [
    ...head.map((p, i) => ({ value: p.amount, colour: resolveProgrammeColour(p.colour, i) })),
    ...(tailAmount > 0 ? [{ value: tailAmount, colour: C.muted }] : []),
  ]

  return (
    <div
      className="flex flex-col gap-4 rounded-card border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      <p className="font-display text-title font-medium" style={{ color: C.ink }}>
        Portfolio by programme
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p
            className="font-display text-heading font-medium leading-none"
            style={{ color: C.ink }}
          >
            {fmtCompact(totals.totalAwarded)}
          </p>
          <p className="font-display text-body" style={{ color: C.sub }}>
            {fmtMoney(totals.paidToDate)} paid · {fmtMoney(totals.outstanding)} outstanding
          </p>
        </div>

        <BarMeter bars={140} height={24} barWidth={3} className="w-full" segments={segments} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {head.map((p, i) => (
            <ShareLegend
              key={p.name}
              colour={resolveProgrammeColour(p.colour, i)}
              amount={p.amount}
              label={p.name}
            />
          ))}
          {tailAmount > 0 && (
            <ShareLegend
              colour={C.muted}
              amount={tailAmount}
              label={`${tail.length} other programme${tail.length === 1 ? '' : 's'}`}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ShareLegend({ colour, amount, label }: { colour: string; amount: number; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="size-2 shrink-0 rounded-swatch" style={{ backgroundColor: colour }} />
      <span className="truncate font-display text-body font-medium" style={{ color: C.faint }}>
        <span style={{ color: C.ink }}>{fmtCompact(amount)}</span> {label}
      </span>
    </div>
  )
}

function AwardsPage() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const { roundId, programmeId, tag, status, q, from, to, sortBy, sortDir, page } = search
  const { items, total, pageSize, totals, facets } = Route.useLoaderData()
  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // The headline figures the KPI tiles used to carry. Here they describe the list rather
  // than competing with it — the same job the applications count does on Applications.
  const metaLine = [
    `${totals.count} award${totals.count !== 1 ? 's' : ''}`,
    totals.count > 0 ? `${fmtCompact(totals.totalAwarded)} awarded` : null,
    totals.count > 0 ? `${fmtCompact(totals.paidToDate)} paid` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Every filter change returns to page 1 — page 4 of the old result set is a different
  // set of awards, and landing there silently is disorienting. Round no longer clears
  // programme and theme the way the header pill did: that was scoping behaviour, and
  // filters in one row do not reach across and empty each other.
  function setRound(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, roundId: id, page: undefined }) })
  }

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
      {/* Header — <h1>, then what you are looking at and how to search it. Round is NOT
          up here: on the round-scoped screens the pill is the axis the whole screen is
          organised around, but a grants portfolio is the whole book of business rather
          than one sitting's decisions, which makes round one narrowing among several. It
          sits in the filter row with the others (see `ui/FilterPill` on the shared order). */}
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-heading font-medium text-grey-900">Awards</h1>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="whitespace-nowrap font-display text-label font-medium text-grey-500">
            {metaLine}
          </span>
          <SearchInput
            value={q}
            onChange={(next) =>
              navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }) })
            }
            placeholder="Search organisation…"
          />
        </div>
      </div>

      {/* Everything below the header is one card, as on Applications and Finance: what
          the portfolio is made of, how you narrow it, and the rows themselves. The table
          keeps a hairline of its own inside it — a card containing a bordered table, not
          a bordered table floating on the page. */}
      <div
        className="flex flex-col gap-4 rounded-card border bg-white p-4"
        style={{ borderColor: C.line }}
      >
        {totals.count > 0 && <PortfolioCard totals={totals} />}

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
          <FilterPill
            label="Round"
            plural="rounds"
            value={roundId}
            options={facets.rounds.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={setRound}
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
          <>
            <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
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
          </>
        )}
      </div>
    </div>
  )
}
