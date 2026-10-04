import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { getEoiNav, listEois } from '../../server/fns/eois'
import {
  Card,
  DataTable,
  DateText,
  EmptyState,
  FilterPill,
  FilterRow,
  OrganisationCell,
  Pagination,
  SearchInput,
  StatusPill,
  Tabs,
  TruncatedText,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { ApplicationsTabs } from '../../components/applications/ApplicationsTabs'
import { fmtAmount, fmtRef } from '../../lib/format'
import { parseEoisSearch, type EoisSearch, type EoisTab } from '../../lib/listSearch'
import { EOI_STATUS_META, EOI_TABS, type EoiStatus } from '../../lib/eois/status'

// ─── Expressions of interest: the tab beside Applications ────────────────────
//
// Every EOI the foundation has received, whoever prompted it: an organisation answering
// an open call, or a sourced partner who was invited to send one. One screen for both,
// on purpose. The Partnerships pipeline shows THAT a partner's EOI arrived and links
// here; it never holds a second copy of the answers.
//
// It has no round. An EOI comes before an application and before the decision about
// which round that application would be in, so this list has no round pill and no
// budget card: neither would have anything true to say. It is filtered by programme,
// which is the one thing an EOI can be filed under.
//
// Two tabs, because there is one question: has somebody read this and decided.

export const Route = createFileRoute('/_authenticated/applications/eois/')({
  validateSearch: parseEoisSearch,
  // Behind the `sourcing` flag, as Partnerships is: see `routes/_authenticated/partnerships.tsx`.
  beforeLoad: ({ context }) => {
    if (!context.user.features.sourcing) throw notFound()
  },
  loaderDeps: ({ search }) => ({
    tab: search.tab,
    programmeId: search.programmeId,
    q: search.q,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const [list, eoiNav] = await Promise.all([listEois({ data: deps }), getEoiNav()])
    return { ...list, eoiNav }
  },
  component: EoisPage,
})

type EoiItem = Awaited<ReturnType<typeof listEois>>['items'][number]

const STATUS_HEX: Record<EoiStatus, string> = {
  submitted: 'var(--color-warning)',
  invited_to_apply: 'var(--color-success)',
  declined: 'var(--color-grey-500)',
  applied: 'var(--color-success)',
}

const COLUMNS: TableColumn<EoiItem>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    cell: (item) => (
      <OrganisationCell
        name={item.organisationName}
        subline={[item.contactEmail, fmtRef(item.reference)].filter(Boolean).join(' · ') || null}
        wrapName={(content, className) => (
          <Link
            to="/applications/eois/$eoiId"
            params={{ eoiId: item.id }}
            search={(prev) => parseEoisSearch(prev)}
            onClick={(e) => e.stopPropagation()}
            className={`${className} hover:underline`}
            style={{ color: C.ink }}
          >
            {content}
          </Link>
        )}
      />
    ),
  },
  {
    id: 'programme',
    hideBelow: 'md',
    header: 'Programme',
    width: 'sm:w-[18%]',
    cell: (item) => (
      // "Not placed" in the faint grey of a thing to do, not a gap in the data: an EOI
      // whose form named no programme is filed under one on its own screen.
      <TruncatedText
        text={item.programme?.name ?? 'Not placed'}
        label="Programme"
        className={`font-display text-body ${item.programme ? 'text-grey-500' : 'text-grey-400'}`}
      />
    ),
  },
  {
    // Where it came from: answering an open call, or a partner the foundation
    // approached. The one fact that tells the two funnels apart on a shared list.
    id: 'route',
    hideBelow: 'lg',
    header: 'Came from',
    width: 'sm:w-[14%]',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">
        {item.partnership ? 'Partnership' : 'Open call'}
      </span>
    ),
  },
  {
    id: 'amount',
    hideBelow: 'lg',
    header: 'Indicative amount',
    width: 'sm:w-[14%]',
    cell: (item) => (
      <span className="font-display text-body text-grey-500">
        {item.amountIndicative ? fmtAmount(item.amountIndicative) : '--'}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[14%]',
    cell: (item) => (
      <StatusPill label={EOI_STATUS_META[item.status].label} colour={STATUS_HEX[item.status]} />
    ),
  },
  {
    id: 'received',
    hideBelow: 'md',
    header: 'Received',
    width: 'sm:w-[11%]',
    cell: (item) => (
      <DateText
        value={item.createdAt}
        className="whitespace-nowrap font-display text-body text-grey-500"
      />
    ),
  },
]

function EoisPage() {
  const { items, total, pageSize, tabCounts, facets, eoiNav } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const { tab: tabParam, programmeId, q, page } = Route.useSearch()
  const tab: EoisTab = tabParam ?? 'to_review'
  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function setFilter(patch: Partial<EoisSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          Applications
        </h1>
        <div className="flex flex-wrap items-center gap-4">
          {/* The whole foundation's count, above every control on the screen. */}
          <span
            className="whitespace-nowrap font-display text-label font-medium"
            style={{ color: C.sub }}
          >
            {eoiNav.toReview > 0
              ? `${eoiNav.toReview} ${eoiNav.toReview === 1 ? 'expression' : 'expressions'} of interest to review`
              : 'No expressions of interest waiting'}
          </span>
          <div className="ml-auto">
            <ApplicationsTabs tab="eois" eoisToReview={eoiNav.toReview} />
          </div>
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-4">
        <Tabs<EoisTab>
          ariaLabel="Expressions of interest"
          value={tab}
          onChange={(next) =>
            navigate({
              search: (prev) => ({
                ...prev,
                tab: next === 'to_review' ? undefined : next,
                page: undefined,
              }),
            })
          }
          items={EOI_TABS.map((t) => ({ id: t.id, label: t.label, count: tabCounts[t.id] }))}
        />

        <FilterRow
          search={
            <SearchInput
              value={q}
              onChange={(next) => setFilter({ q: next })}
              placeholder="Search name, reference or email…"
              ariaLabel="Search expressions of interest"
              className="sm:w-72"
            />
          }
        >
          <FilterPill
            label="Programme"
            plural="programmes"
            value={programmeId}
            options={facets.programmes}
            onChange={(v) => setFilter({ programmeId: v })}
          />
        </FilterRow>

        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
          <DataTable
            columns={COLUMNS}
            rows={items}
            rowKey={(item) => item.id}
            onRowClick={(item) =>
              navigate({
                to: '/applications/eois/$eoiId',
                params: { eoiId: item.id },
                search: (prev) => prev,
              })
            }
            empty={
              <div className="p-4">
                <EmptyState>
                  <p className="text-body text-grey-500">
                    {tab === 'to_review' ? 'Nothing waiting to be read.' : 'Nothing decided yet.'}
                  </p>
                  <p className="mt-1 text-label text-grey-400">
                    {tab === 'to_review'
                      ? 'Expressions of interest sent from your own form arrive here. The address to post them to is under Settings, API keys.'
                      : 'Try the other tab, or clear the filters.'}
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
            noun="expressions of interest"
            onChange={(p) =>
              navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
            }
          />
        )}
      </Card>
    </div>
  )
}
