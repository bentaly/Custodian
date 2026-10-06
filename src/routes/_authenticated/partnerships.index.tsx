import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { fmtAmount } from '../../lib/format'
import { useState } from 'react'
import { Add01Icon, ArchiveIcon, ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { listPartnerships, PARTNERSHIPS_DEFAULT_SORT } from '../../server/fns/partnerships'
import { listMyRounds } from '../../server/fns/rounds'
import {
  Button,
  Card,
  DataTable,
  DateText,
  EmptyState,
  FilterPill,
  initials,
  Pagination,
  FilterRow,
  SearchInput,
  StatusPill,
  TruncatedList,
  TruncatedText,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import {
  PartnershipDialog,
  emptyPartnershipDraft,
  type PartnershipDraft,
} from '../../components/partnerships/PartnershipDialog'
import {
  parsePartnershipsSearch,
  type PartnershipsSearch,
  type PartnershipsSortKey as SortKey,
  type SortDir,
} from '../../lib/listSearch'
import {
  PARTNERSHIP_STATUS_META,
  PARTNERSHIP_STATUSES,
  type PartnershipStatus,
} from '../../lib/partnerships/status'
import { AiScoreCell, DueDiligenceCell } from '../../components/applications/cells'

// ─── Partnerships: the pipeline before an application ────────────────────────
//
// Every other list in the app is a list of things that have HAPPENED — an application
// arrived, a grant was made, a report came in. This is a list of conversations, and it
// is the only screen a foundation looks at to answer a question about the future:
// where is the next round's shortlist going to come from?
//
// Two consequences shape the screen.
//
// **The tabs are whose move it is, not what the status is.** Five statuses would have
// given five tabs, two of which ("EOI sent", "Invited to apply") mean the identical
// thing to the person reading — nothing to do, chase in a fortnight — while burying the
// two that are actually work. So the tabs are the three answers to "who is being waited
// on": To action, Awaiting them, Closed. The status pill still says exactly which state
// a row is in; the tab says whether it needs you. `lib/partnerships/status` holds the
// mapping, and the server counts from the same table.
//
// **There is no budget on this screen, and that is deliberate.** The prototype put a
// programme budget meter across the top, filled from committed grants. Finance and the
// annual budget panel already answer that question and are pinned to each other by the
// money rule (CLAUDE.md); a third bar drawn from a third query is precisely how the
// 2026-08-27 discrepancy happened. A pipeline is counted in conversations, and the value
// proposed for a partner is shown on its own record and summed nowhere.
//
// Clicking a row opens `/partnerships/$partnershipId` — a page, not a drawer. See that
// file for why.

export const Route = createFileRoute('/_authenticated/partnerships/')({
  // Tab, filters, sort and page live in the URL, as on every other list — so a filtered
  // pipeline is a link, and so the detail screen's back arrow can hand it back. See
  // `lib/listSearch`.
  validateSearch: parsePartnershipsSearch,
  loaderDeps: ({ search }) => ({
    status: search.status,
    programmeId: search.programmeId,
    source: search.source,
    tag: search.tag,
    q: search.q,
    archived: search.archived,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const [list, rounds] = await Promise.all([listPartnerships({ data: deps }), listMyRounds()])
    return { ...list, rounds }
  },
  component: PartnershipsPage,
})

type PartnershipItem = Awaited<ReturnType<typeof listPartnerships>>['items'][number]

/** Text reads best A–Z; a date newest-first. Matches the Applications and Reports rule. */
const ASC_FIRST: SortKey[] = ['organisation', 'programme', 'source']

const STATUS_HEX: Record<PartnershipStatus, string> = {
  prospective: 'var(--color-grey-500)',
  eoi_issued: 'var(--color-info)',
  eoi_received: 'var(--color-warning)',
  invited: 'var(--color-success)',
  declined: 'var(--color-danger)',
  applied: 'var(--color-success)',
}

const COLUMNS: TableColumn<PartnershipItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    // No width of its own: it takes what the others leave, which they keep to about
    // 28% between them so a name like "British Heart Foundation" fits. They
    // summed to 93% once, and the name read "Bri…".
    //
    // The house identity cell, as Applications and Reports draw it: monogram, name, and
    // a subline of the facts that tell two similarly-named charities apart: the
    // registration number, where the work would be, and how the relationship started.
    cell: (item) => {
      const subline =
        [
          item.charityNumber ? `Charity ${item.charityNumber}` : null,
          item.companyNumber && !item.charityNumber ? `Company ${item.companyNumber}` : null,
          item.deliveryArea,
          // Source lives here since it lost its column (2026-10-06): its filter pill
          // stays, and a pill must leave a visible mark on the rows it keeps.
          item.source,
        ]
          .filter(Boolean)
          .join(' · ') || '--'
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
              to="/partnerships/$partnershipId"
              params={{ partnershipId: item.id }}
              /* As the row click: same URL either way, tab and filters included. Parsed
                 rather than spread because these columns are module-level, so `prev` is
                 typed as every route's search at once. */
              search={(prev) => parsePartnershipsSearch(prev)}
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
    // The round they would be funded from, chosen when they were logged.
    id: 'round',
    hideBelow: 'lg',
    header: 'Round',
    width: 'sm:w-[9%]',
    cell: (item) => (
      <TruncatedText
        text={item.roundProgramme?.round.name ?? '--'}
        label="Round"
        className={`font-display text-body ${item.roundProgramme ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    width: 'sm:w-[11%]',
    cell: (item) => (
      // "Not decided yet" rather than an em-dash: on this table a blank programme is the
      // ordinary state of a new prospect, not a gap in the data, and the faint grey says
      // so without inviting anyone to go and fix it.
      <TruncatedText
        text={item.programme?.name ?? 'Not decided'}
        label="Programme"
        className={`font-display text-body ${item.programme ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    // The grant value proposed. Not a commitment and summed nowhere (see the module
    // comment): a figure per row, never a total.
    id: 'amount',
    sortable: true,
    hideBelow: 'md',
    header: 'Amount',
    width: 'sm:w-[8%]',
    cell: (item) => (
      <span className="whitespace-nowrap font-display text-body text-grey-500">
        {item.amountSought ? fmtAmount(item.amountSought) : '--'}
      </span>
    ),
  },
  {
    // Filterable, so it must leave a visible mark on the rows it keeps (see
    // `filterable-needs-a-column`). Not sortable — a prospect carrying three themes has
    // no place in an ordering.
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[11%]',
    cell: (item) => (
      <TruncatedList
        items={item.tags ?? []}
        label="Themes for this organisation"
        className={`font-display text-body ${
          (item.tags ?? []).length > 0 ? 'text-grey-500' : 'text-grey-400'
        }`}
      />
    ),
  },
  {
    id: 'logged',
    sortable: true,
    hideBelow: 'xl',
    header: 'Logged',
    width: 'sm:w-[8%]',
    cell: (item) => (
      <DateText
        value={item.createdAt}
        className="whitespace-nowrap font-display text-body text-grey-500"
      />
    ),
  },
  {
    id: 'status',
    sortable: true,
    header: 'Status',
    width: 'sm:w-[10%]',
    cell: (item) => (
      <StatusPill
        label={PARTNERSHIP_STATUS_META[item.status].label}
        colour={STATUS_HEX[item.status]}
      />
    ),
  },
  {
    // The same bar and figure as Applications: one score, one scale, drawn one way.
    id: 'score',
    sortable: true,
    hideBelow: 'md',
    header: 'AI score',
    width: 'sm:w-[8%]',
    cell: (item) => <AiScoreCell status={item.custodianScoreStatus} score={item.custodianScore} />,
  },
  {
    // The Applications mark, so a result reads the same on both screens.
    id: 'dueDiligence',
    sortable: true,
    hideBelow: 'md',
    header: 'Due diligence',
    width: 'sm:w-[7%]',
    stopRowClick: true,
    cell: (item) => <DueDiligenceCell status={item.dueDiligenceStatus} />,
  },
]

function PartnershipsPage() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { items, total, pageSize, portfolio, archivedCount, facets, rounds } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const { status, programmeId, source, tag, q, archived, sortBy, sortDir, page } = Route.useSearch()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [draft, setDraft] = useState<PartnershipDraft | undefined>()

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Every filter change returns to page 1 — page 3 of the old result set is a different
  // set of organisations, and landing there silently is disorienting.
  function setFilter(patch: Partial<PartnershipsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) })
  }

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
    navigate({ search: (prev) => ({ ...prev, sortBy: key, sortDir: nextDir, page: undefined }) })
  }

  // The whole pipeline, never the filtered view: this line sits above the tabs and the
  // filter row, and a control narrows only what is below it. It used to read the tab
  // counts, so filtering by programme rewrote the page's own subtitle to "0 live" while
  // the foundation plainly had six.
  const waiting = portfolio.toAction
  const metaLine = archived
    ? `${archivedCount} archived`
    : [
        `${portfolio.live} live`,
        waiting > 0 ? `${waiting} waiting on you` : 'nothing waiting on you',
      ].join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
            {archived ? 'Archived partners' : 'Partnerships'}
          </h1>
          <span className="font-display text-label font-medium" style={{ color: C.sub }}>
            {metaLine}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The archive is a DESTINATION, not a fourth tab. The tabs answer "whose move
              is it" about a live pipeline; an archived row is not in the pipeline at
              all, and giving it a tab would put a permanent count of decisions nobody
              is revisiting next to three counts of work. */}
          {archived ? (
            <Button
              variant="secondary"
              icon={ArrowLeft01Icon}
              onClick={() => navigate({ search: {} })}
            >
              Back to pipeline
            </Button>
          ) : (
            archivedCount > 0 && (
              <Button
                variant="secondary"
                icon={ArchiveIcon}
                onClick={() => navigate({ search: { archived: true } })}
              >
                Archive ({archivedCount})
              </Button>
            )
          )}
          {canManage && !archived && (
            <Button icon={Add01Icon} onClick={() => setDraft(emptyPartnershipDraft())}>
              Log a partner
            </Button>
          )}
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-4">
        {/* The shared filter row, in the shared order, with search on its right
            (`ui/FilterRow`). The whose-move tabs went (feedback, 2026-10-05); Status is a
            pill like any other, and with nothing ticked the list is every live partner. */}
        <FilterRow
          search={
            <SearchInput
              value={q}
              onChange={(next) => setFilter({ q: next })}
              placeholder="Search organisation or charity number"
              ariaLabel="Search partnerships"
              className="sm:w-72"
            />
          }
        >
          <FilterPill
            label="Status"
            plural="statuses"
            value={status}
            options={PARTNERSHIP_STATUSES.map((s) => ({
              value: s,
              label: PARTNERSHIP_STATUS_META[s].label,
            }))}
            onChange={(v) => setFilter({ status: v as PartnershipStatus[] | undefined })}
          />
          <FilterPill
            label="Programme"
            plural="programmes"
            value={programmeId}
            options={facets.programmes}
            onChange={(v) => setFilter({ programmeId: v })}
          />
          <FilterPill
            label="Theme"
            plural="themes"
            value={tag}
            options={facets.themes}
            onChange={(v) => setFilter({ tag: v })}
          />
          <FilterPill
            label="Source"
            plural="sources"
            value={source}
            options={facets.sources}
            onChange={(v) => setFilter({ source: v })}
          />
        </FilterRow>

        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
          <DataTable
            columns={COLUMNS}
            rows={items}
            rowKey={(item) => item.id}
            onRowClick={(item) =>
              navigate({
                to: '/partnerships/$partnershipId',
                params: { partnershipId: item.id },
                // Tab and filters ride along, so the record's back arrow returns to the
                // list as it was read — see `lib/listSearch`.
                search: (prev) => prev,
              })
            }
            sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : PARTNERSHIPS_DEFAULT_SORT}
            onSort={setSort}
            empty={
              <div className="p-4">
                <EmptyState>
                  <p className="text-body text-grey-500">
                    {archived ? 'Nothing archived.' : 'No partners match these filters.'}
                  </p>
                  <p className="mt-1 text-label text-grey-400">
                    {archived
                      ? 'Archiving a partner keeps their history and takes them out of the pipeline.'
                      : 'Organisations you are proactively considering appear here before they apply. Log one with its charity number and Custodian screens it.'}
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
            noun="partners"
            onChange={(p) =>
              navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
            }
          />
        )}
      </Card>

      <PartnershipDialog
        open={draft !== undefined}
        draft={draft}
        rounds={rounds}
        onClose={() => setDraft(undefined)}
        // Straight onto the record: a prospect is logged in order to be screened and
        // decided about, and dropping the person back on the list would make them find
        // the row they just created to do either.
        onSaved={(id) => {
          setDraft(undefined)
          router.invalidate()
          navigate({ to: '/partnerships/$partnershipId', params: { partnershipId: id } })
        }}
      />
    </div>
  )
}
