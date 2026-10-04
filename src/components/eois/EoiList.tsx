import { Link } from '@tanstack/react-router'
import type { listEois } from '../../server/fns/eois'
import {
  DataTable,
  DateText,
  EmptyState,
  FilterRow,
  OrganisationCell,
  Pagination,
  SearchInput,
  StatusPill,
  Tabs,
  type TableColumn,
} from '../ui'
import { C } from '../ui/tokens'
import { fmtAmount, fmtRef } from '../../lib/format'
import { EOI_STATUS_META, EOI_TABS, type EoiStatus, type EoiTab } from '../../lib/eois/status'

// The expressions of interest for ONE programme, drawn inside the Applications card when
// its switch is on "EOIs" (option A of the placement review, 2026-10-04).
//
// It lives in the card rather than on a page of its own because an EOI belongs to a
// programme, and the card is already organised by programme: the pill above it decides
// whose EOIs these are, exactly as it decides whose applications the table shows. What
// the card normally carries that an EOI has no use for (the budget, the export, the
// status, theme and score filters) is not drawn while this is.
//
// There is no round here. An EOI comes before the decision about which round an
// application would go into, so the round pill above narrows applications and not this.

type EoiItem = Awaited<ReturnType<typeof listEois>>['items'][number]

const STATUS_HEX: Record<EoiStatus, string> = {
  submitted: 'var(--color-warning)',
  invited_to_apply: 'var(--color-success)',
  declined: 'var(--color-grey-500)',
  applied: 'var(--color-success)',
}

function columns(listSearch: Record<string, unknown>): TableColumn<EoiItem>[] {
  return [
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
              search={listSearch}
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
      // Where it came from: an open call, or a partner the foundation approached. The
      // one fact that tells the two funnels apart on a shared list.
      id: 'route',
      hideBelow: 'md',
      header: 'Came from',
      width: 'sm:w-[16%]',
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
      width: 'sm:w-[16%]',
      cell: (item) => (
        <span className="font-display text-body text-grey-500">
          {item.amountIndicative ? fmtAmount(item.amountIndicative) : '--'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'sm:w-[16%]',
      cell: (item) => (
        <StatusPill label={EOI_STATUS_META[item.status].label} colour={STATUS_HEX[item.status]} />
      ),
    },
    {
      id: 'received',
      hideBelow: 'md',
      header: 'Received',
      width: 'sm:w-[12%]',
      cell: (item) => (
        <DateText
          value={item.createdAt}
          className="whitespace-nowrap font-display text-body text-grey-500"
        />
      ),
    },
  ]
}

export function EoiList({
  data,
  tab,
  q,
  listSearch,
  onTab,
  onSearch,
  onPage,
  onOpen,
}: {
  data: Awaited<ReturnType<typeof listEois>>
  tab: EoiTab
  q: string | undefined
  /** The Applications search, carried onto an EOI so its back arrow returns here. */
  listSearch: Record<string, unknown>
  onTab: (tab: EoiTab) => void
  onSearch: (q: string | undefined) => void
  onPage: (page: number) => void
  onOpen: (id: string) => void
}) {
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))
  return (
    <>
      <FilterRow
        search={
          <SearchInput
            value={q}
            onChange={onSearch}
            placeholder="Search name, reference or email…"
            ariaLabel="Search expressions of interest"
          />
        }
      >
        <Tabs<EoiTab>
          ariaLabel="Expressions of interest"
          value={tab}
          onChange={onTab}
          items={EOI_TABS.map((t) => ({ id: t.id, label: t.label, count: data.tabCounts[t.id] }))}
        />
      </FilterRow>

      <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
        <DataTable
          columns={columns(listSearch)}
          rows={data.items}
          rowKey={(item) => item.id}
          onRowClick={(item) => onOpen(item.id)}
          empty={
            <div className="p-4">
              <EmptyState>
                <p className="font-display text-body" style={{ color: C.sub }}>
                  {tab === 'to_review'
                    ? 'No expressions of interest waiting for this programme.'
                    : 'Nothing decided yet for this programme.'}
                </p>
                {tab === 'to_review' && (
                  <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
                    They arrive from your own form. The address to send them to is under Settings,
                    API keys.
                  </p>
                )}
              </EmptyState>
            </div>
          }
        />
      </div>

      {data.total > 0 && (
        <Pagination
          page={data.page}
          pageCount={pageCount}
          shown={data.items.length}
          total={data.total}
          noun="expressions of interest"
          onChange={onPage}
        />
      )}
    </>
  )
}
