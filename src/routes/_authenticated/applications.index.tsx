import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Search01Icon,
  Calendar03Icon,
  Download01Icon,
  Tick02Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
} from '@hugeicons/core-free-icons'
import { listApplications, getRoundBudgetSummary, updateApplicationStatus } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import type { DueDiligenceStatus } from '../../lib/dueDiligence'
import { getRoundStatus } from '../../lib/roundStatus'
import { ApplicationStatus, ScoreBand } from '../../lib/validators/application'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { EmptyState } from '../../components/ui'

const PAGE_SIZE = 25

// ─── Design tokens (Figma variables — pinned until the token set lands) ──────────
const C = {
  ink: '#141C24', // Gray/900
  sub: '#637083', // Gray/500
  faint: '#97A1AF', // Gray/400
  line: '#E4E7EC', // Gray/200
  wash: '#F2F4F7', // Gray/100
  brand: '#1F7A5C',
  brandBg: 'rgba(31, 122, 92, 0.1)',
  brandBorder: 'rgba(31, 122, 92, 0.2)',
  success: '#31A650',
  amber: '#9B6916',
  danger: '#FF4242',
}

type SortKey = 'organisation' | 'amount' | 'status' | 'score' | 'dueDiligence'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['organisation', 'amount', 'status', 'score', 'dueDiligence']

type ApplicationsSearch = {
  roundId?: string
  programmeId?: string
  status?: ApplicationStatus
  scoreBand?: ScoreBand
  tag?: string
  q?: string
  sortBy?: SortKey
  sortDir?: SortDir
  page?: number
}

export const Route = createFileRoute('/_authenticated/applications/')({
  validateSearch: (search: Record<string, unknown>): ApplicationsSearch => {
    const page = Number(search.page)
    return {
      roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
      programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
      status: ApplicationStatus.optional().catch(undefined).parse(search.status),
      scoreBand: ScoreBand.optional().catch(undefined).parse(search.scoreBand),
      tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
      q: typeof search.q === 'string' && search.q ? search.q : undefined,
      sortBy: SORT_KEYS.includes(search.sortBy as SortKey) ? (search.sortBy as SortKey) : undefined,
      sortDir: search.sortDir === 'asc' || search.sortDir === 'desc' ? (search.sortDir as SortDir) : undefined,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    }
  },
  loaderDeps: ({ search }) => ({
    roundId: search.roundId,
    programmeId: search.programmeId,
    status: search.status,
    scoreBand: search.scoreBand,
    tag: search.tag,
    q: search.q,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const rounds = await listMyRounds()

    // Default to the most recent non-upcoming round when no roundId is in the URL
    let roundId = deps.roundId
    if (!roundId) {
      const candidate = rounds
        .filter((r) => getRoundStatus(r) !== 'upcoming')
        .sort((a, b) => {
          const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
          const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
          return bT - aT
        })[0]
      // Preserve any other filters (q from the header search, status, etc.) —
      // only the missing roundId is being filled in.
      if (candidate) throw redirect({ to: '/applications', search: { ...deps, roundId: candidate.id, page: undefined } })
    }

    const [applicationsData, budgetSummary] = await Promise.all([
      listApplications({
        data: {
          page: deps.page ?? 1,
          pageSize: PAGE_SIZE,
          roundId,
          programmeId: deps.programmeId,
          status: deps.status,
          scoreBand: deps.scoreBand,
          tag: deps.tag,
          q: deps.q,
          sortBy: deps.sortBy,
          sortDir: deps.sortDir,
        },
      }),
      roundId ? getRoundBudgetSummary({ data: { roundId } }) : Promise.resolve([]),
    ])
    return { ...applicationsData, rounds, budgetSummary }
  },
  component: ApplicationsList,
})

// ─── Formatting ──────────────────────────────────────────────────────────────────

function fmtAmount(amount: string | number | null | undefined) {
  if (amount == null || amount === '') return '—'
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  if (isNaN(n)) return '—'
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

const SCORE_BAND_OPTIONS: Array<{ value: ScoreBand; label: string }> = [
  { value: '90plus', label: '90+' },
  { value: '80to89', label: '80–89' },
  { value: '70to79', label: '70–79' },
  { value: 'below70', label: 'Below 70' },
]

const STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
  { value: 'for_review', label: 'For review' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'declined', label: 'Declined' },
]

// Application status → pill. Colours follow the Figma table (amber "in review",
// green shortlisted, brand-green awarded, red declined).
const STATUS_PILL: Record<string, { label: string; color: string }> = {
  for_review: { label: 'In review', color: C.amber },
  shortlisted: { label: 'Shortlisted', color: C.success },
  awarded: { label: 'Awarded', color: C.brand },
  declined: { label: 'Declined', color: C.danger },
}

// ─── CSV export ────────────────────────────────────────────────────────────────

type AppItem = ReturnType<typeof Route.useLoaderData>['items'][number]

function exportCsv(items: AppItem[], filename: string) {
  const headers = ['Organisation', 'Reference', 'Amount requested', 'Programme', 'Theme', 'AI score', 'Due diligence', 'Status']
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = items.map((a) =>
    [
      a.organisationName,
      a.externalApplicationId ?? '',
      a.amountRequested ?? '',
      a.roundProgramme?.programme?.name ?? '',
      ((a.roundProgramme?.programme?.tags as string[] | null) ?? []).join('; '),
      a.custodianScoreStatus === 'scored' && a.custodianScore != null ? a.custodianScore : '',
      a.dueDiligenceStatus ?? '',
      STATUS_PILL[a.status]?.label ?? a.status,
    ]
      .map(esc)
      .join(','),
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Header controls ─────────────────────────────────────────────────────────────

// Round selector — the Figma pill (icon chip + name + status), with a real native
// <select> laid transparently over it so the control stays keyboard-accessible.
function RoundSelect({
  rounds,
  value,
  statusLabel,
  onChange,
}: {
  rounds: Array<{ id: string; name: string }>
  value: string | undefined
  statusLabel: string | null
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
}) {
  const current = rounds.find((r) => r.id === value)
  return (
    <div className="relative shrink-0">
      <div
        className="flex items-center gap-2 rounded-[12px] border bg-white py-1 pl-1 pr-3"
        style={{ borderColor: C.line }}
      >
        <div className="flex size-8 items-center justify-center rounded-lg" style={{ backgroundColor: C.wash }}>
          <HugeiconsIcon icon={Calendar03Icon} size={16} color={C.brand} />
        </div>
        <span className="whitespace-nowrap font-display text-[14px] font-medium" style={{ color: C.brand }}>
          {current?.name ?? 'Select round'}
        </span>
        {statusLabel && (
          <span className="whitespace-nowrap font-display text-[12px] font-medium" style={{ color: C.faint }}>
            · {statusLabel}
          </span>
        )}
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.sub} />
      </div>
      <select
        aria-label="Select round"
        value={value ?? ''}
        onChange={onChange}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        {rounds.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// Filter dropdown pill (Status / Theme / AI score) — Figma style, native <select> over it.
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | undefined
  options: Array<{ value: string; label: string }>
  onChange: (v: string | undefined) => void
}) {
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative shrink-0">
      <div
        className="flex h-8 items-center gap-1 rounded-lg border bg-white pl-2 pr-1.5"
        style={{ borderColor: current ? C.brand : C.line, backgroundColor: current ? C.brandBg : '#fff' }}
      >
        <span
          className="whitespace-nowrap font-display text-[14px] font-medium"
          style={{ color: current ? C.brand : C.ink }}
        >
          {current ? current.label : label}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={current ? C.brand : C.sub} />
      </div>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Round budget (single dominos bar for the selected round) ────────────────────

type BudgetRow = Awaited<ReturnType<typeof getRoundBudgetSummary>>[number]

function BudgetLegend({ color, amount, label, count }: { color: string; amount: number; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="font-display text-[14px] font-medium" style={{ color: C.faint }}>
        <span style={{ color: C.ink }}>{fmtAmount(amount)}</span> {label}
        {count != null ? ` (${count})` : ''}
      </span>
    </div>
  )
}

function programmeSegments(row: BudgetRow) {
  const budget = row.budget ?? 0
  const unallocated = Math.max(0, budget - row.awarded - row.shortlisted)
  return [
    { value: row.awarded, color: C.success },
    { value: row.shortlisted, color: withAlpha(C.success, 0.5) },
    { value: unallocated, color: withAlpha(C.success, 0.1) },
  ]
}

function RoundBudget({
  rows,
  title,
  showBreakdown,
}: {
  rows: BudgetRow[]
  title: string
  showBreakdown: boolean
}) {
  const [brokenDown, setBrokenDown] = useState(false)

  const totalBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0)
  const totalAwarded = rows.reduce((s, r) => s + r.awarded, 0)
  const totalShortlisted = rows.reduce((s, r) => s + r.shortlisted, 0)
  const awardedCount = rows.reduce((s, r) => s + r.awardedCount, 0)
  const shortlistedCount = rows.reduce((s, r) => s + r.shortlistedCount, 0)
  const committed = totalAwarded + totalShortlisted
  const unallocated = Math.max(0, totalBudget - committed)

  return (
    <div className="flex flex-col gap-4 rounded-[16px] border bg-white p-4" style={{ borderColor: C.line }}>
      <p className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
        {title}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-[24px] font-medium leading-none" style={{ color: C.ink }}>
            {fmtCompact(committed)}
          </p>
          <p className="font-display text-[14px]" style={{ color: C.sub }}>
            {fmtAmount(committed)} committed of {fmtAmount(totalBudget)}
          </p>
        </div>

        <BarMeter
          bars={140}
          height={24}
          barWidth={3}
          className="w-full"
          segments={
            totalBudget > 0
              ? [
                  { value: totalAwarded, color: C.success },
                  { value: totalShortlisted, color: withAlpha(C.success, 0.5) },
                  { value: unallocated, color: withAlpha(C.success, 0.1) },
                ]
              : [{ value: 1, color: withAlpha(C.success, 0.1) }]
          }
        />

        <div className="flex flex-wrap items-center gap-4">
          <BudgetLegend color={C.success} amount={totalAwarded} label="awarded" count={awardedCount} />
          <BudgetLegend color={withAlpha(C.success, 0.5)} amount={totalShortlisted} label="shortlisted" count={shortlistedCount} />
          <BudgetLegend color={withAlpha(C.success, 0.1)} amount={unallocated} label="unallocated" />
        </div>
      </div>

      {showBreakdown && (
        <button
          type="button"
          onClick={() => setBrokenDown((v) => !v)}
          className="flex h-8 items-center gap-1 self-start rounded-lg border bg-white pl-3 pr-2"
          style={{ borderColor: C.line }}
        >
          <span className="font-display text-[14px] font-medium" style={{ color: C.brand }}>
            Break down by programme
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={16}
            color={C.brand}
            style={{ transform: brokenDown ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
          />
        </button>
      )}

      {showBreakdown && brokenDown && (
        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: C.line }}>
          {rows.map((row) => (
            <div key={row.roundProgrammeId} className="flex items-center gap-3">
              <span className="w-44 shrink-0 truncate font-display text-[14px] font-medium" style={{ color: C.ink }} title={row.programmeName}>
                {row.programmeName}
              </span>
              <div className="flex-1">
                {row.budget != null ? (
                  <BarMeter bars={60} height={16} barWidth={3} className="w-full" segments={programmeSegments(row)} />
                ) : (
                  <span className="font-display text-[12px]" style={{ color: C.faint }}>
                    No budget set
                  </span>
                )}
              </div>
              <span className="w-32 shrink-0 text-right font-display text-[12px] tabular-nums" style={{ color: C.sub }}>
                {fmtCompact(row.committed)}
                {row.budget != null ? ` / ${fmtCompact(row.budget)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Table cells ─────────────────────────────────────────────────────────────────

function RowCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={checked}
      aria-label={checked ? 'Deselect' : 'Select'}
      className="flex size-5 items-center justify-center rounded-[6px] border transition-colors"
      style={{ borderColor: checked ? C.brand : C.line, backgroundColor: checked ? C.brand : '#fff' }}
    >
      {checked && <HugeiconsIcon icon={Tick02Icon} size={12} color="#fff" />}
    </button>
  )
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL[status] ?? { label: status, color: C.sub }
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-[20px] px-2"
      style={{ backgroundColor: withAlpha(s.color, 0.1) }}
    >
      <span className="size-[3px] rounded-full" style={{ backgroundColor: s.color }} />
      <span className="font-display text-[12px] font-medium" style={{ color: s.color }}>
        {s.label}
      </span>
    </span>
  )
}

function scoreBandColor(score: number) {
  if (score >= 80) return C.success
  if (score >= 60) return C.amber
  return C.danger
}

function AiScoreCell({ status, score }: { status: string | null | undefined; score: number | null | undefined }) {
  const has = status === 'scored' && score != null
  const color = has ? scoreBandColor(score!) : null
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-[3px] w-10 overflow-hidden rounded-full"
        style={{ backgroundColor: has ? withAlpha(color!, 0.1) : C.wash }}
      >
        {has && (
          <div
            className="bar-grow absolute left-0 top-0 h-full rounded-full"
            style={{ width: `${Math.min(100, score!)}%`, backgroundColor: color! }}
          />
        )}
      </div>
      {has && (
        <span className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
          {score}
        </span>
      )}
    </div>
  )
}

const DD_ICON: Record<string, { icon: typeof CheckmarkCircle02Icon; color: string } | null> = {
  clear: { icon: CheckmarkCircle02Icon, color: C.success },
  warning: { icon: CheckmarkCircle02Icon, color: C.amber },
  blocked: { icon: CancelCircleIcon, color: C.danger },
  review: { icon: CancelCircleIcon, color: C.faint },
  pending: null,
}

function DueDiligenceCell({ status }: { status: DueDiligenceStatus }) {
  const d = DD_ICON[status]
  if (!d) return <span className="inline-block size-5 rounded-full border" style={{ borderColor: C.line }} />
  return <HugeiconsIcon icon={d.icon} size={20} color={d.color} />
}

// Bulk status action for the selected rows. An action menu (not a filter) — it never
// reflects a value; picking an option applies it and resets. "Awarded" is intentionally
// absent: awarding runs through the dedicated grant flow, not a status flip.
function BulkStatusMenu({ busy, onPick }: { busy: boolean; onPick: (s: ApplicationStatus) => void }) {
  return (
    <div className="relative">
      <div className="flex h-8 items-center gap-1 rounded-lg border bg-white pl-3 pr-2" style={{ borderColor: C.line }}>
        <span className="whitespace-nowrap font-display text-[14px] font-medium" style={{ color: C.ink }}>
          {busy ? 'Updating…' : 'Change status'}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.sub} />
      </div>
      <select
        aria-label="Change status of selected applications"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value as ApplicationStatus)
        }}
        className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-wait"
      >
        <option value="">Change status…</option>
        <option value="for_review">Move to review</option>
        <option value="shortlisted">Shortlist</option>
        <option value="declined">Decline</option>
      </select>
    </div>
  )
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 text-left font-display text-[14px] font-medium ${className}`} style={{ color: C.ink }}>
      {children}
    </th>
  )
}

// Sortable column header — label + a state arrow (faint up/down when inactive,
// solid directional arrow when this column is the active sort).
function SortTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  className = '',
}: {
  label: string
  sortKey: SortKey
  active: boolean
  dir: SortDir | undefined
  onSort: (k: SortKey) => void
  className?: string
}) {
  return (
    <th className={`px-3 text-left ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="group flex items-center gap-1 font-display text-[14px] font-medium"
        style={{ color: C.ink }}
      >
        {label}
        {active ? (
          <HugeiconsIcon icon={dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon} size={14} color={C.sub} />
        ) : (
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <HugeiconsIcon icon={ArrowUpDownIcon} size={14} color={C.faint} />
          </span>
        )}
      </button>
    </th>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────────

function ApplicationsList() {
  const navigate = useNavigate({ from: '/applications/' })
  const router = useRouter()
  const search = Route.useSearch()
  const { roundId, programmeId, status, scoreBand, tag, q, sortBy, sortDir, page } = search
  const { items, total, rounds, budgetSummary } = Route.useLoaderData()

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Debounced local state for the organisation search box.
  const [searchTerm, setSearchTerm] = useState(q ?? '')
  useEffect(() => {
    setSearchTerm(q ?? '')
  }, [q])
  useEffect(() => {
    const next = searchTerm.trim() || undefined
    if (next === (q ?? undefined)) return
    const t = setTimeout(() => {
      navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }) })
    }, 300)
    return () => clearTimeout(t)
  }, [searchTerm]) // eslint-disable-line react-hooks/exhaustive-deps

  // Row selection (scoped to the current page) + bulk shortlist.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setSelected(new Set())
  }, [roundId, programmeId, status, scoreBand, tag, q, page])

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
      const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
      return bT - aT
    })

  const selectedRound = rounds.find((r) => r.id === roundId)
  const roundStatus = selectedRound ? getRoundStatus(selectedRound) : null
  const statusLabel =
    roundStatus === 'open' ? 'Current round' : roundStatus === 'closed' ? 'Closed' : roundStatus ? 'Upcoming' : null

  // Distinct themes (tags) across the round's programmes, for the Theme filter.
  const tags = [...new Set(budgetSummary.flatMap((r) => r.tags))].sort()

  // Programme tabs (the primary browsing axis), with per-programme counts.
  const allTabCount = budgetSummary.reduce((s, r) => s + r.total, 0)
  const programmeTabs = [
    { id: undefined as string | undefined, name: 'All', count: allTabCount },
    ...budgetSummary.map((r) => ({ id: r.programmeId, name: r.programmeName, count: r.total })),
  ]

  // Budget is scoped to the selected programme tab (whole round on "All").
  const scopedBudget = programmeId ? budgetSummary.filter((r) => r.programmeId === programmeId) : budgetSummary
  const selectedProgrammeName = programmeId
    ? budgetSummary.find((r) => r.programmeId === programmeId)?.programmeName
    : null
  const budgetTitle = selectedProgrammeName ? `${selectedProgrammeName} budget` : 'Round budget'

  // Round-close meta line.
  const metaLine = (() => {
    const parts = [`${total} application${total !== 1 ? 's' : ''}`]
    if (selectedRound?.closedAt) {
      const days = Math.ceil((new Date(selectedRound.closedAt).getTime() - Date.now()) / 86_400_000)
      if (roundStatus === 'closed' || days < 0) {
        parts.push(`closed ${new Date(selectedRound.closedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)
      } else {
        parts.push(`closes in ${days} day${days !== 1 ? 's' : ''}`)
      }
    }
    return parts.join(' · ')
  })()

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    navigate({ search: (prev) => ({ ...prev, roundId: e.target.value || undefined, programmeId: undefined, tag: undefined, page: undefined }) })
  }
  function setProgramme(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, programmeId: id, page: undefined }) })
  }
  function setStatus(value: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, status: (value as ApplicationStatus) || undefined, page: undefined }) })
  }
  function setTag(value: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, tag: value || undefined, page: undefined }) })
  }
  function setScoreBand(value: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, scoreBand: (value as ScoreBand) || undefined, page: undefined }) })
  }
  function goToPage(p: number) {
    navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
  }
  // Click a header: first click sorts by its natural default direction (text asc,
  // numeric/score desc); clicking the active column flips direction.
  function setSort(key: SortKey) {
    const defaultDir: SortDir = key === 'organisation' || key === 'status' || key === 'dueDiligence' ? 'asc' : 'desc'
    navigate({
      search: (prev) => {
        const active = prev.sortBy === key
        const nextDir: SortDir = active ? (prev.sortDir === 'asc' ? 'desc' : 'asc') : defaultDir
        return { ...prev, sortBy: key, sortDir: nextDir, page: undefined }
      },
    })
  }

  const allSelected = items.length > 0 && items.every((a) => selected.has(a.id))
  function toggleAll() {
    setSelected((prev) => (items.every((a) => prev.has(a.id)) ? new Set() : new Set(items.map((a) => a.id))))
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedItems = items.filter((a) => selected.has(a.id))
  const combinedAsk = selectedItems.reduce((s, a) => s + (parseFloat(a.amountRequested ?? '0') || 0), 0)

  // Bulk status change for the selected rows. Awarded applications are skipped —
  // un-awarding would orphan the award/grant records (that's the generateAward flow).
  async function bulkSetStatus(status: ApplicationStatus) {
    const targets = selectedItems.filter((a) => a.status !== status && a.status !== 'awarded')
    if (targets.length === 0) {
      setSelected(new Set())
      return
    }
    setBusy(true)
    try {
      for (const a of targets) {
        await updateApplicationStatus({ data: { id: a.id, status } })
      }
      setSelected(new Set())
      await router.invalidate()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update the selected applications')
    } finally {
      setBusy(false)
    }
  }

  // CSV export of the whole programme (or the whole round on the "All" tab) — the
  // full set, not just the loaded page. Transient filters (status/theme/score/search)
  // are deliberately ignored so the export is the complete programme list.
  const [exporting, setExporting] = useState(false)
  async function handleExport() {
    setExporting(true)
    try {
      const all = await listApplications({ data: { page: 1, pageSize: 10_000, roundId, programmeId } })
      const scope = programmeId ? budgetSummary.find((r) => r.programmeId === programmeId)?.programmeName : selectedRound?.name
      exportCsv(all.items, `applications-${scope ?? 'export'}.csv`.replace(/\s+/g, '-'))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not export applications')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
          Applications
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {visibleRounds.length > 0 && (
              <RoundSelect rounds={visibleRounds} value={roundId} statusLabel={statusLabel} onChange={handleRoundChange} />
            )}
            <span className="whitespace-nowrap font-display text-[12px] font-medium" style={{ color: C.sub }}>
              {metaLine}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex h-10 items-center gap-2 rounded-[12px] px-3" style={{ backgroundColor: C.wash }}>
              <HugeiconsIcon icon={Search01Icon} size={16} color={C.sub} />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search organisation or ID…"
                className="w-52 bg-transparent font-display text-[14px] outline-none placeholder:text-[#637083]"
                style={{ color: C.ink }}
              />
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="flex h-10 items-center gap-2 rounded-[12px] border px-3 disabled:opacity-60"
              style={{ backgroundColor: C.brandBg, borderColor: C.brandBorder }}
            >
              <span className="font-display text-[14px] font-medium" style={{ color: C.brand }}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </span>
              <HugeiconsIcon icon={Download01Icon} size={18} color={C.brand} />
            </button>
          </div>
        </div>
      </div>

      {/* Programme tabs — the primary browsing axis, above the budget */}
      {programmeTabs.length > 1 && (
        <div className="flex items-center gap-0.5 self-start overflow-x-auto rounded-lg p-0.5" style={{ backgroundColor: C.wash }}>
          {programmeTabs.map((t) => {
            const on = programmeId === t.id
            return (
              <button
                key={t.id ?? 'all'}
                type="button"
                onClick={() => setProgramme(t.id)}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2"
                style={on ? { backgroundColor: '#fff', border: `1px solid ${C.line}` } : undefined}
              >
                <span className="whitespace-nowrap font-display text-[14px] font-medium" style={{ color: on ? C.ink : C.sub }}>
                  {t.name}
                </span>
                <span className="font-display text-[14px] font-medium" style={{ color: C.faint }}>
                  {t.count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Budget for the selected programme (whole round on the "All" tab) */}
      {scopedBudget.length > 0 && (
        <RoundBudget rows={scopedBudget} title={budgetTitle} showBreakdown={!programmeId} />
      )}

      {/* Table card */}
      <div className="overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: C.line }}>
        {/* Filter dropdowns */}
        <div className="flex flex-wrap items-center justify-end gap-3 p-4">
          <FilterSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          {tags.length > 0 && (
            <FilterSelect label="Theme" value={tag} options={tags.map((t) => ({ value: t, label: t }))} onChange={setTag} />
          )}
          <FilterSelect label="AI score" value={scoreBand} options={SCORE_BAND_OPTIONS} onChange={setScoreBand} />
        </div>

        {/* Selection toolbar — appears above the table when rows are selected */}
        {selected.size > 0 && (
          <div
            className="flex items-center justify-between gap-3 border-t px-4 py-2.5"
            style={{ borderColor: C.line, backgroundColor: C.wash }}
          >
            <span className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
              {selected.size} selected · {fmtAmount(combinedAsk)} combined ask
            </span>
            <div className="flex items-center gap-2">
              <BulkStatusMenu busy={busy} onPick={bulkSetStatus} />
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="flex h-8 items-center rounded-lg px-3 font-display text-[14px] font-medium"
                style={{ color: C.sub }}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState>
              <p className="font-display text-[14px]" style={{ color: C.sub }}>
                No applications match these filters.
              </p>
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="h-10" style={{ backgroundColor: C.wash }}>
                  <th className="w-11 px-3">
                    <RowCheck checked={allSelected} onToggle={toggleAll} />
                  </th>
                  <SortTh label="Organisation" sortKey="organisation" active={sortBy === 'organisation'} dir={sortDir} onSort={setSort} />
                  <SortTh label="Amount" sortKey="amount" active={sortBy === 'amount'} dir={sortDir} onSort={setSort} className="w-[130px]" />
                  <Th className="w-[200px]">Programme</Th>
                  <Th className="w-[160px]">Theme</Th>
                  <SortTh label="Status" sortKey="status" active={sortBy === 'status'} dir={sortDir} onSort={setSort} className="w-[130px]" />
                  <SortTh label="AI score" sortKey="score" active={sortBy === 'score'} dir={sortDir} onSort={setSort} className="w-[110px]" />
                  <SortTh label="Due diligence" sortKey="dueDiligence" active={sortBy === 'dueDiligence'} dir={sortDir} onSort={setSort} className="w-[120px]" />
                </tr>
              </thead>
              <tbody>
                {items.map((app) => {
                  const prog = app.roundProgramme?.programme?.name ?? '—'
                  const themes = (app.roundProgramme?.programme?.tags as string[] | null) ?? []
                  const type = app.charityNumber ? 'Reg. charity' : app.companyNumber ? 'Company' : null
                  const area = app.deliveryRegion ?? app.deliveryArea ?? null
                  const subline = [type, area, app.externalApplicationId].filter(Boolean).join(' · ') || '—'
                  return (
                    <tr
                      key={app.id}
                      onClick={() => navigate({ to: '/applications/$applicationId', params: { applicationId: app.id } })}
                      className="h-16 cursor-pointer transition-colors hover:bg-[#f9fafb]"
                    >
                      <td className="w-11 px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                        <RowCheck checked={selected.has(app.id)} onToggle={() => toggleOne(app.id)} />
                      </td>
                      <td className="px-3 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: C.wash }}>
                            <span className="font-display text-[14px] font-semibold" style={{ color: C.ink }}>
                              {initials(app.organisationName)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <Link
                              to="/applications/$applicationId"
                              params={{ applicationId: app.id }}
                              onClick={(e) => e.stopPropagation()}
                              className="block truncate font-display text-[14px] font-medium hover:underline"
                              style={{ color: C.ink }}
                            >
                              {app.organisationName}
                            </Link>
                            <p className="truncate font-display text-[12px]" style={{ color: C.sub }}>
                              {subline}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 align-middle font-display text-[14px] font-medium tabular-nums" style={{ color: C.ink }}>
                        {fmtAmount(app.amountRequested)}
                      </td>
                      <td className="px-3 align-middle">
                        <span className="font-display text-[14px]" style={{ color: C.ink }}>
                          {prog}
                        </span>
                      </td>
                      <td className="px-3 align-middle">
                        {themes.length > 0 ? (
                          <span className="font-display text-[14px]" style={{ color: C.sub }}>
                            {themes[0]}
                            {themes.length > 1 && (
                              <span style={{ color: C.faint }}> +{themes.length - 1}</span>
                            )}
                          </span>
                        ) : (
                          <span className="font-display text-[14px]" style={{ color: C.faint }}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 align-middle">
                        <StatusPill status={app.status} />
                      </td>
                      <td className="px-3 align-middle">
                        <AiScoreCell status={app.custodianScoreStatus} score={app.custodianScore} />
                      </td>
                      <td className="px-3 align-middle">
                        <DueDiligenceCell status={(app.dueDiligenceStatus ?? 'pending') as DueDiligenceStatus} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && pageCount > 1 && (
        <div className="flex items-center justify-between font-display text-[14px]" style={{ color: C.sub }}>
          <span>
            {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: C.line, color: C.ink }}
            >
              Previous
            </button>
            <span className="tabular-nums" style={{ color: C.faint }}>
              Page {currentPage} of {pageCount}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: C.line, color: C.ink }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
