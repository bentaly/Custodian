import { Fragment } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CompactMoney,
  DataTable,
  DateRangePicker,
  DateText,
  EmptyState,
  FilterPill,
  ImportedPill,
  Pagination,
  FilterRow,
  SearchInput,
  StatusPill,
  TruncatedList,
  TruncatedText,
  initials,
  type TableColumn,
} from '../../components/ui'
import { BarMeter } from '../../components/BarMeter'
import { ProgressBar } from '../../components/ProgressBar'
import { listAwards, GRANT_STATUS_LABELS, AWARDS_DEFAULT_SORT } from '../../server/fns/applications'
import { facetLabel } from '../../lib/facets'
import { C } from '../../components/ui/tokens'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { fmtDate, fmtMoney, fmtRef } from '../../lib/format'
import {
  parseAwardsSearch,
  type AwardStatus,
  type AwardsSortKey as SortKey,
  type SortDir,
} from '../../lib/listSearch'

type AwardItem = ReturnType<typeof Route.useLoaderData>['items'][number]

/** Text reads best A–Z; money, dates and counts read best biggest/newest first. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'round', 'geography']

export const Route = createFileRoute('/_authenticated/awards/')({
  // Shared with the grant screen, which carries this search through so its back arrow
  // returns to the register as it was read — see `lib/listSearch`.
  validateSearch: parseAwardsSearch,
  loaderDeps: ({ search }) => ({
    roundId: search.roundId,
    programmeId: search.programmeId,
    tag: search.tag,
    status: search.status,
    region: search.region,
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
    //
    // `deps` is passed WHOLE, not field by field. It used to be re-listed here, and
    // because every key on the validator is `.optional()`, a filter added to the deps
    // above and forgotten here typechecked perfectly and then silently filtered nothing
    // — the pill highlighted, the count was right, the rows never moved. That is exactly
    // how Location shipped broken. `loaderDeps` already IS the argument.
    listAwards({ data: deps }),
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
    // Monogram + two-line identity, as on Applications. The subline is the foundation's
    // own reference for the grantee — an identifying fact with no column of its own,
    // reachable through search rather than a pill.
    //
    // Round left this subline when it gained a column, and LOCATION has now followed it
    // for the same reason. The rule the register follows: anything you can FILTER by has
    // somewhere on the row to be read, or the filter is a control whose effect you cannot
    // see — pick a region and every row looks the same. The converse is what moved it
    // OUT: once location is filterable it needs a header to sort by and a place a reader
    // can scan down, and a subline shared with a reference number is neither.
    cell: (g) => {
      const subline = fmtRef(g.externalApplicationId) || '—'
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
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                to="/awards/$awardId"
                params={{ awardId: g.awardId }}
                /* As the row click: same URL either way, filters included. Parsed rather
                   than spread because these columns are module-level, so `prev` is typed
                   as every route's search at once. */
                search={(prev) => parseAwardsSearch(prev)}
                onClick={(e) => e.stopPropagation()}
                className="block truncate font-display text-body font-medium hover:underline"
                style={{ color: C.ink }}
              >
                {g.organisationName}
              </Link>
              {g.imported && <ImportedPill />}
            </div>
            <p className="truncate font-display text-label" style={{ color: C.sub }}>
              {subline}
            </p>
          </div>
        </div>
      )
    },
  },
  {
    id: 'round',
    sortable: true,
    hideBelow: 'xl',
    header: 'Round',
    width: 'sm:w-[10%]',
    cell: (g) => (
      <TruncatedText
        text={g.roundName ?? '—'}
        label="Round"
        className={`font-display text-body ${g.roundName ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    width: 'sm:w-[12%]',
    cell: (g) => (
      <TruncatedText
        text={g.programmeName ?? '—'}
        label="Programme"
        className={`font-display text-body ${g.programmeName ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    // Not sortable: themes are a jsonb array on the programme, so "sorted by theme" has
    // no answer for a grant carrying three of them. It is a filter and a fact to read.
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[10%]',
    cell: (g) => (
      <TruncatedList
        items={g.tags}
        label="Themes for this grant"
        className={`font-display text-body ${g.tags.length > 0 ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    // Two lines, and they are two different questions. The top is the SHARPEST thing the
    // resolver got — a district, else the matched area's own name (what a county-level
    // match carries), else the applicant's own words for a location that never resolved.
    // The bottom is the region, which is the only one of the two you can filter by.
    //
    // Printing just the region made every grantee of a regional funder read "North West",
    // the one fact the reader already knew. Printing just the district left the Location
    // pill selecting on a value that appeared nowhere on the row. Both, and each explains
    // the other.
    //
    // Sorted on the top line (`geography` → `lower(deliveryArea)`), because that is the
    // column a reader is scanning; NULLs last whichever way the arrow points.
    id: 'geography',
    sortable: true,
    hideBelow: 'lg',
    header: 'Location',
    width: 'sm:w-[12%]',
    cell: (g) => {
      // A region-level match resolves to no district, so the coalesce falls through to
      // the region itself and both lines would say "North West". One line, then.
      const place = g.deliveryArea
      const region = g.deliveryRegion && g.deliveryRegion !== place ? g.deliveryRegion : null
      if (!place) return <span className="font-display text-body text-grey-400">—</span>
      return (
        <div className="min-w-0">
          <TruncatedText
            text={place}
            label="Where this grant is delivered"
            className="font-display text-body text-grey-700"
          />
          {region && (
            <TruncatedText
              text={region}
              label="Region"
              className="font-display text-label text-grey-500"
            />
          )}
        </div>
      )
    },
  },
  {
    id: 'awarded',
    sortable: true,
    hideBelow: 'lg',
    header: 'Awarded',
    width: 'sm:w-[9%]',
    cell: (g) => <DateText value={g.decisionAt} className={`whitespace-nowrap ${txtSub}`} />,
  },
  {
    id: 'amount',
    sortable: true,
    header: 'Amount',
    width: 'sm:w-[9%]',
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
    width: 'sm:w-[14%]',
    // This used to read "£22k / 3" — paid money over an instalment COUNT, two different
    // units either side of a slash, which is why it read as nonsense. It now answers the
    // question the column is actually for: how far through paying this grant are we.
    //
    // The lifecycle pill lives here rather than in a column of its own because it is a
    // statement ABOUT this progress and nothing else: `awards.status` is re-derived from
    // the instalments on every payment (`markInstalmentPaid`), so "Complete" means precisely
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
          {/* Exact, not `fmtCompact`: this is a figure a foundation reconciles against its
              own ledger, it sits directly beside the exact Amount column, and "£5k of
              £10k" against a schedule of two £5,000 instalments made the row read as a
              summary of itself rather than as the money. Exact figures are wide, which is
              why the pill moved down to the instalment line — it is still a statement
              about the bar, now sitting under it rather than over it. */}
          <span className="whitespace-nowrap font-display text-body tabular-nums text-grey-700">
            <span className="font-medium text-grey-900">{fmtMoney(g.paidToDate)}</span> of{' '}
            {fmtMoney(g.amountAwarded)}
          </span>
          <ProgressBar
            value={g.amountAwarded > 0 ? g.paidToDate / g.amountAwarded : 0}
            colour={g.status === 'cancelled' ? C.muted : C.success}
            height={4}
            animate={false}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="whitespace-nowrap font-display text-label text-grey-500">
              {g.paidCount} of {g.instalmentCount} instalment{g.instalmentCount === 1 ? '' : 's'}
            </span>
            {pill}
          </div>
        </div>
      )
    },
  },
  {
    id: 'duration',
    sortable: true,
    hideBelow: 'xl',
    header: 'Duration',
    width: 'sm:w-[7%]',
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
            <CompactMoney amount={totals.totalAwarded} label="Exact total awarded" />
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
        <span style={{ color: C.ink }}>
          <CompactMoney amount={amount} label={`Exact total for ${label}`} />
        </span>{' '}
        {label}
      </span>
    </div>
  )
}

function AwardsPage() {
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const { roundId, programmeId, tag, status, region, q, from, to, sortBy, sortDir, page } = search
  const { items, total, pageSize, totals, facets } = Route.useLoaderData()
  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // The headline figures the KPI tiles used to carry. Here they describe the list rather
  // than competing with it — the same job the applications count does on Applications.
  // Nodes rather than a joined string, so the two rounded figures can each hand over
  // their exact value on hover — see `CompactMoney`.
  const metaLine: React.ReactNode[] = [
    `${totals.count} award${totals.count !== 1 ? 's' : ''}`,
    ...(totals.count > 0
      ? [
          <>
            <CompactMoney amount={totals.totalAwarded} label="Exact total awarded" /> awarded
          </>,
          <>
            <CompactMoney amount={totals.paidToDate} label="Exact total paid" /> paid
          </>,
        ]
      : []),
  ]

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

  function setRegion(value: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, region: value, page: undefined }) })
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
      {/* Header — <h1>, then what you are looking at. Round is NOT up here: on the
          round-scoped screens the pill is the axis the whole screen is organised around,
          but a grants portfolio is the whole book of business rather than one sitting's
          decisions, which makes round one narrowing among several. It sits in the filter
          row with the others (see `ui/FilterPill` on the shared order), and so does the
          search box (`ui/FilterRow`). */}
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-heading font-medium text-grey-900">Awards</h1>
        <span className="whitespace-nowrap font-display text-label font-medium text-grey-500">
          {metaLine.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              {part}
            </Fragment>
          ))}
        </span>
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

        {/* Filters — the same row every list screen wears, in the shared order, search
            on its right (`ui/FilterRow`). Each pill offers only what the awards in view
            actually contain, with counts, and stays in place when that is one value or
            none (see `ui/FilterPill`). */}
        <FilterRow
          search={
            <SearchInput
              value={q}
              onChange={(next) =>
                navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }) })
              }
              placeholder="Search organisation…"
            />
          }
        >
          <FilterPill
            label="Status"
            plural="statuses"
            value={status}
            options={facets.statuses.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={setStatus}
          />
          <FilterPill
            label="Round"
            plural="rounds"
            value={roundId}
            options={facets.rounds.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={setRound}
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
          {/* Region, not the place name printed on the row: a district is very nearly a
              primary key (ten grants, ten districts), so a pill of them would be one
              option per award. The Location column shows both, which is what keeps this
              pill legible — you can see on every row why it matched. */}
          <FilterPill
            label="Location"
            plural="locations"
            value={region}
            options={facets.regions.map((f) => ({ value: f.value, label: facetLabel(f) }))}
            onChange={setRegion}
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
        </FilterRow>

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
                  navigate({
                    to: '/awards/$awardId',
                    params: { awardId: g.awardId },
                    // The register's filters ride along, so the grant's back arrow can
                    // return to it as it was read — see `lib/listSearch`.
                    search: (prev) => prev,
                  })
                }
                // With nothing clicked the register is still ordered — most recently
                // awarded first — so the header says so.
                sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : AWARDS_DEFAULT_SORT}
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
