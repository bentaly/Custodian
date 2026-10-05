import { Link } from '@tanstack/react-router'
import type { listEois } from '../../server/fns/eois'
import {
  DataTable,
  DateRangePicker,
  DateText,
  EmptyState,
  FilterPill,
  FilterRow,
  OrganisationCell,
  Pagination,
  SearchInput,
  StatusPill,
  type TableColumn,
} from '../ui'
import { C } from '../ui/tokens'
import { fmtAmount, fmtRef } from '../../lib/format'
import { EOI_STATUSES, EOI_STATUS_META, type EoiStatus } from '../../lib/eois/status'

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
  status,
  q,
  dates,
  listSearch,
  onStatus,
  onDates,
  onSearch,
  onPage,
  onOpen,
}: {
  data: Awaited<ReturnType<typeof listEois>>
  status: EoiStatus[] | undefined
  q: string | undefined
  /** The received-date window, shared with the applications view's. */
  dates: { from?: string; to?: string }
  /** The Applications search, carried onto an EOI so its back arrow returns here. */
  listSearch: Record<string, unknown>
  onStatus: (status: EoiStatus[] | undefined) => void
  onDates: (dates: { from?: string; to?: string }) => void
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
        {/* The Applications filter row's shape (feedback, 2026-10-05): Status, then the
            date. Theme and AI score wait on whether EOIs are assessed at all. */}
        <FilterPill
          label="Status"
          plural="statuses"
          value={status}
          options={EOI_STATUSES.map((s) => ({ value: s, label: EOI_STATUS_META[s].label }))}
          onChange={(v) => onStatus(v as EoiStatus[] | undefined)}
        />
        <DateRangePicker value={dates} onChange={onDates} allLabel="Any date" />
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
                  {status || dates.from || dates.to || q
                    ? 'No expressions of interest match these filters.'
                    : 'No expressions of interest for this programme yet.'}
                </p>
                {!status && !dates.from && !dates.to && !q && (
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
