import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Add01Icon, ArchiveIcon, ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { listPartnerships, PARTNERSHIPS_DEFAULT_SORT } from '../../server/fns/partnerships'
import { listClientTags, listProgrammes } from '../../server/fns/programmes'
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
  Tabs,
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
import { facetLabel } from '../../lib/facets'
import { fmtRef } from '../../lib/format'
import {
  parsePartnershipsSearch,
  type PartnershipsSearch,
  type PartnershipsSortKey as SortKey,
  type PartnershipsTab as Tab,
  type SortDir,
} from '../../lib/listSearch'
import {
  PARTNERSHIP_STATUS_META,
  PARTNERSHIP_TABS,
  type PartnershipStatus,
} from '../../lib/partnerships/status'
import { DD_LABEL, DD_TONE_HEX } from '../../components/partnerships/dueDiligenceTone'

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
// **There is no money on this screen, and that is deliberate.** The prototype put a
// programme budget meter across the top, filled from committed grants. Finance and the
// annual budget panel already answer that question and are pinned to each other by the
// money rule (CLAUDE.md); a third bar drawn from a third query is precisely how the
// 2026-08-27 discrepancy happened. A pipeline is counted in conversations.
//
// Clicking a row opens `/partnerships/$partnershipId` — a page, not a drawer. See that
// file for why.

export const Route = createFileRoute('/_authenticated/partnerships/')({
  // Tab, filters, sort and page live in the URL, as on every other list — so a filtered
  // pipeline is a link, and so the detail screen's back arrow can hand it back. See
  // `lib/listSearch`.
  validateSearch: parsePartnershipsSearch,
  loaderDeps: ({ search }) => ({
    tab: search.tab,
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
    const [list, programmes, clientTags] = await Promise.all([
      listPartnerships({ data: deps }),
      listProgrammes(),
      listClientTags(),
    ])
    return { ...list, programmes, clientTags }
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
}

const COLUMNS: TableColumn<PartnershipItem>[] = [
  {
    id: 'organisation',
    sortable: true,
    header: 'Organisation',
    // The house identity cell, as Applications and Reports draw it: monogram, name, and
    // a subline of the facts that tell two similarly-named charities apart. The
    // foundation's own reference sits last, in the same place it does on every other
    // list, so a row can be tied back to their systems without opening it.
    cell: (item) => {
      const subline =
        [item.organisationType, item.location, fmtRef(item.reference)]
          .filter(Boolean)
          .join(' · ') || '—'
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
    id: 'programme',
    sortable: true,
    hideBelow: 'lg',
    header: 'Programme',
    width: 'sm:w-[14%]',
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
    // Filterable, so it must leave a visible mark on the rows it keeps (see
    // `filterable-needs-a-column`). Not sortable — a prospect carrying three themes has
    // no place in an ordering.
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[13%]',
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
    // The column that earns its place on this screen and no other: it is the only
    // measure a foundation has of whether its pipeline reaches past the board's own
    // address book.
    id: 'source',
    sortable: true,
    hideBelow: 'xl',
    header: 'Source',
    width: 'sm:w-[13%]',
    cell: (item) => (
      <TruncatedText
        text={item.source ?? '—'}
        label="Source"
        className={`font-display text-body ${item.source ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    id: 'status',
    sortable: true,
    header: 'Status',
    width: 'sm:w-[13%]',
    cell: (item) => (
      <StatusPill
        label={PARTNERSHIP_STATUS_META[item.status].label}
        colour={STATUS_HEX[item.status]}
      />
    ),
  },
  {
    id: 'dueDiligence',
    sortable: true,
    hideBelow: 'md',
    header: 'Due diligence',
    width: 'sm:w-[12%]',
    cell: (item) => (
      <StatusPill
        label={DD_LABEL[item.dueDiligenceStatus]}
        colour={DD_TONE_HEX[item.dueDiligenceStatus]}
      />
    ),
  },
  {
    id: 'logged',
    sortable: true,
    hideBelow: 'xl',
    header: 'Logged',
    width: 'sm:w-[10%]',
    cell: (item) => (
      <DateText
        value={item.createdAt}
        className="whitespace-nowrap font-display text-body text-grey-500"
      />
    ),
  },
]

function PartnershipsPage() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { items, total, pageSize, tabCounts, archivedCount, facets, programmes, clientTags } =
    Route.useLoaderData()
  const navigate = Route.useNavigate()
  const {
    tab: tabParam,
    programmeId,
    source,
    tag,
    q,
    archived,
    sortBy,
    sortDir,
    page,
  } = Route.useSearch()
  const tab: Tab = tabParam ?? 'to_action'
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [draft, setDraft] = useState<PartnershipDraft | undefined>()

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Switching tab always starts at page 1 — page 3 of one tab is not page 3 of another.
  // The sort DOES survive it here, unlike Reports: all three tabs draw the same columns
  // off the same table, so an ordering set on one is meaningful on the next.
  function setTab(next: Tab) {
    navigate({
      search: (prev) => ({
        ...prev,
        tab: next === 'to_action' ? undefined : next,
        page: undefined,
      }),
    })
  }

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

  const waiting = tabCounts.to_action
  const metaLine = archived
    ? `${archivedCount} archived`
    : [
        `${tabCounts.to_action + tabCounts.awaiting} live`,
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
        {/* Hidden in the archive: "whose move is it" has one answer there, and it is
            nobody's. */}
        {!archived && (
          <Tabs
            ariaLabel="Whose move it is"
            value={tab}
            onChange={setTab}
            items={PARTNERSHIP_TABS.map((t) => ({
              id: t.id,
              label: t.label,
              count: tabCounts[t.id],
            }))}
          />
        )}

        {/* The shared filter row, in the shared order, with search on its right
            (`ui/FilterRow`). Status is absent because the tabs are it — at the level this
            screen cares about. */}
        <FilterRow
          search={
            <SearchInput
              value={q}
              onChange={(next) => setFilter({ q: next })}
              placeholder="Search name, reference or place…"
              ariaLabel="Search partnerships"
              className="sm:w-72"
            />
          }
        >
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
            label="Source"
            plural="sources"
            value={source}
            options={facets.sources.map((f) => ({ value: f.value, label: facetLabel(f) }))}
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
                    {archived
                      ? 'Nothing archived.'
                      : (PARTNERSHIP_TABS.find((t) => t.id === tab)?.empty ?? 'Nothing here.')}
                  </p>
                  <p className="mt-1 text-label text-grey-400">
                    {archived
                      ? 'Archiving a partner keeps their history and takes them out of the pipeline.'
                      : tab === 'to_action'
                        ? 'Organisations you are talking to appear here before they apply. Log one when a trustee makes an introduction.'
                        : 'Try another tab, or clear the filters.'}
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
        programmes={programmes.map((p) => ({ id: p.id, name: p.name }))}
        themeSuggestions={clientTags}
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
