import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { listActivity, listActivityActors } from '../../server/fns/activity'
import type { ActivityRow } from '../../server/fns/activity'
import {
  DataTable,
  DateRangePicker,
  ExportButton,
  Pagination,
  Panel,
  SelectPill,
  type DateRange,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { SettingsPage } from '../../components/SettingsPage'
import { fmtDateTime } from '../../lib/format'
import {
  ACTION_CATEGORY,
  ACTION_LABEL,
  ACTION_VERB,
  CATEGORY_LABELS,
  type AuditCategory,
} from '../../lib/audit'

const PAGE_SIZE = 25

export const Route = createFileRoute('/_authenticated/settings/activity')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({
    first: await listActivity({ data: { page: 1, pageSize: PAGE_SIZE } }),
    actors: await listActivityActors(),
  }),
  component: Activity,
})

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as AuditCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}))

function Activity() {
  const { first, actors } = Route.useLoaderData()

  const [rows, setRows] = useState(first)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState<AuditCategory | ''>('')
  const [actorUserId, setActorUserId] = useState('')
  const [range, setRange] = useState<DateRange>({})
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const filters = {
    ...(category ? { category } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  }

  async function load(next: {
    page?: number
    category?: AuditCategory | ''
    actorUserId?: string
    range?: DateRange
  }) {
    const nextPage = next.page ?? 1
    const nextCategory = next.category ?? category
    const nextActor = next.actorUserId ?? actorUserId
    const nextRange = next.range ?? range

    setLoading(true)
    try {
      const result = await listActivity({
        data: {
          page: nextPage,
          pageSize: PAGE_SIZE,
          ...(nextCategory ? { category: nextCategory } : {}),
          ...(nextActor ? { actorUserId: nextActor } : {}),
          ...(nextRange.from ? { from: nextRange.from } : {}),
          ...(nextRange.to ? { to: nextRange.to } : {}),
        },
      })
      setRows(result)
      setPage(nextPage)
    } finally {
      setLoading(false)
    }
  }

  // Any filter change returns to page one: staying on page 4 of a set that just became
  // two pages long shows an empty table and reads as "nothing happened".
  function changeCategory(value: string) {
    const next = (value || '') as AuditCategory | ''
    setCategory(next)
    void load({ category: next, page: 1 })
  }
  function changeActor(value: string) {
    setActorUserId(value)
    void load({ actorUserId: value, page: 1 })
  }
  function changeRange(next: DateRange) {
    setRange(next)
    void load({ range: next, page: 1 })
  }

  // The export is the whole filtered set, not the page on screen. This file is what
  // goes to an auditor or a regulator; 25 of 4,000 rows would be worse than none.
  async function handleExport() {
    setExporting(true)
    try {
      const all = await listActivity({ data: { page: 1, pageSize: 10_000, ...filters } })
      exportCsv(all.items)
    } finally {
      setExporting(false)
    }
  }

  const columns: TableColumn<ActivityRow>[] = [
    {
      id: 'at',
      header: 'When',
      width: 'sm:w-[17%]',
      cell: (r) => (
        <span className="font-display text-body whitespace-nowrap" style={{ color: C.sub }}>
          {fmtDateTime(r.at) ?? '—'}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Who',
      width: 'sm:w-[15%]',
      hideBelow: 'md',
      cell: (r) => (
        <span className="font-display text-body font-medium" style={{ color: C.ink }}>
          {/* An actor is `set null` on delete, so the history outlives the person. */}
          {r.actorName ?? 'Someone since removed'}
        </span>
      ),
    },
    {
      id: 'what',
      header: 'What happened',
      cell: (r) => (
        <span className="font-display text-body" style={{ color: C.sub }}>
          {ACTION_VERB[r.action]}{' '}
          <span style={{ color: C.ink }} className="font-medium">
            {r.subject ?? '—'}
          </span>
        </span>
      ),
    },
    {
      id: 'detail',
      header: 'Detail',
      width: 'sm:w-[25%]',
      hideBelow: 'lg',
      cell: (r) =>
        r.detail ? (
          <span className="font-display text-label" style={{ color: C.sub }}>
            {r.detail}
          </span>
        ) : null,
    },
  ]

  const pageCount = Math.max(1, Math.ceil(rows.total / PAGE_SIZE))

  return (
    <SettingsPage
      title="Activity"
      description="Every action anyone has taken in Custodian, newest first. Nothing here can be edited or removed — an entry is only ever added, including when the thing it describes is deleted."
    >
      <div className="flex flex-wrap items-center gap-2">
        <SelectPill
          size="sm"
          label="Category"
          ariaLabel="Filter by category"
          options={CATEGORY_OPTIONS}
          value={category || undefined}
          onChange={changeCategory}
          placeholder="All"
          clearLabel="All categories"
        />
        <SelectPill
          size="sm"
          label="Person"
          ariaLabel="Filter by person"
          options={actors.map((a: { id: string; name: string }) => ({
            value: a.id,
            label: a.name,
          }))}
          value={actorUserId || undefined}
          onChange={changeActor}
          placeholder="Anyone"
          clearLabel="Anyone"
        />
        <DateRangePicker value={range} onChange={changeRange} allLabel="All time" align="left" />
        <span className="ml-auto">
          <ExportButton
            onClick={handleExport}
            busy={exporting}
            disabled={rows.total === 0}
            size="sm"
          />
        </span>
      </div>

      <Panel>
        <DataTable
          columns={columns}
          rows={rows.items}
          rowKey={(r) => r.id}
          empty={
            rows.total === 0 && !Object.keys(filters).length
              ? 'Nothing has happened yet.'
              : 'No activity matches these filters.'
          }
        />
        {rows.total > 0 && (
          <div className="mt-4">
            <Pagination
              page={page}
              pageCount={pageCount}
              shown={rows.items.length}
              total={rows.total}
              noun="entries"
              onChange={(p) => void load({ page: p })}
            />
          </div>
        )}
        {loading && (
          <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
            Loading…
          </p>
        )}
      </Panel>
    </SettingsPage>
  )
}

/**
 * The compliance file. Columns are split rather than pre-composed into the screen's
 * sentence — this is opened in a spreadsheet and filtered on, so the action, the
 * subject and the detail each need their own column.
 *
 * The timestamp goes out in ISO, not the screen's format: a file leaving the building
 * is read by whoever asked for it, and a localised date is ambiguous by the time it
 * gets there.
 */
function exportCsv(rows: ActivityRow[]) {
  const header = ['When (UTC)', 'Category', 'Action', 'Who', 'Subject', 'Detail', 'Application ID']
  const body = rows.map((r) => [
    new Date(r.at).toISOString(),
    CATEGORY_LABELS[ACTION_CATEGORY[r.action]],
    ACTION_LABEL[r.action],
    r.actorName ?? '',
    r.subject ?? '',
    r.detail,
    r.applicationId ?? '',
  ])
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `custodian-activity-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
