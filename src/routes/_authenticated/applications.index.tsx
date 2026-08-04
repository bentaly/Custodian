import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Search01Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  Alert02Icon,
} from '@hugeicons/core-free-icons'
import {
  listApplications,
  getRoundBudgetSummary,
  updateApplicationStatus,
} from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import type { DueDiligenceStatus } from '../../lib/dueDiligence'
import { getRoundStatus } from '../../lib/roundStatus'
import {
  APPLICATION_STATUS_OPTIONS,
  ApplicationStatus,
  ScoreBand,
} from '../../lib/validators/application'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import {
  DataTable,
  DateRangePicker,
  EmptyState,
  ExportButton,
  FilterPill,
  Pagination,
  StatusPill,
  RoundSelect,
  SelectPill,
  type TableColumn,
} from '../../components/ui'
import { fmtAmount, fmtCompact } from '../../lib/format'

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
  bar: '#17211D', // the dark selection bar
  mint: '#8AE8C6', // its meta text
}

type SortKey = 'organisation' | 'amount' | 'status' | 'score' | 'dueDiligence'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['organisation', 'amount', 'status', 'score', 'dueDiligence']

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

type ApplicationsSearch = {
  roundId?: string
  programmeId?: string
  status?: ApplicationStatus
  scoreBand?: ScoreBand
  tag?: string
  q?: string
  /** Inclusive submission-date window (`yyyy-mm-dd`). */
  from?: string
  to?: string
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
      from: typeof search.from === 'string' && ISO_DAY.test(search.from) ? search.from : undefined,
      to: typeof search.to === 'string' && ISO_DAY.test(search.to) ? search.to : undefined,
      sortBy: SORT_KEYS.includes(search.sortBy as SortKey) ? (search.sortBy as SortKey) : undefined,
      sortDir:
        search.sortDir === 'asc' || search.sortDir === 'desc'
          ? (search.sortDir as SortDir)
          : undefined,
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
    from: search.from,
    to: search.to,
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
      if (candidate)
        throw redirect({
          to: '/applications',
          search: { ...deps, roundId: candidate.id, page: undefined },
        })
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
          submittedFrom: deps.from,
          submittedTo: deps.to,
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
  const headers = [
    'Organisation',
    'Reference',
    'Amount requested',
    'Programme',
    'Theme',
    'AI score',
    'Due diligence',
    'Status',
  ]
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

// Filter dropdown pill (Status / Theme / AI score) — Figma style, native <select> over it.
// ─── Round budget (single dominos bar for the selected round) ────────────────────

type BudgetRow = Awaited<ReturnType<typeof getRoundBudgetSummary>>[number]

function BudgetLegend({
  color,
  amount,
  label,
  count,
}: {
  color: string
  amount: number
  label: string
  count?: number
}) {
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

function BudgetCard({ rows, title }: { rows: BudgetRow[]; title: string }) {
  const totalBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0)
  const totalAwarded = rows.reduce((s, r) => s + r.awarded, 0)
  const totalShortlisted = rows.reduce((s, r) => s + r.shortlisted, 0)
  const awardedCount = rows.reduce((s, r) => s + r.awardedCount, 0)
  const shortlistedCount = rows.reduce((s, r) => s + r.shortlistedCount, 0)
  const committed = totalAwarded + totalShortlisted
  const unallocated = Math.max(0, totalBudget - committed)

  return (
    <div
      className="flex flex-col gap-4 rounded-[16px] border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      <p className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
        {title}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
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
          <BudgetLegend
            color={C.success}
            amount={totalAwarded}
            label="awarded"
            count={awardedCount}
          />
          <BudgetLegend
            color={withAlpha(C.success, 0.5)}
            amount={totalShortlisted}
            label="shortlisted"
            count={shortlistedCount}
          />
          <BudgetLegend
            color={withAlpha(C.success, 0.1)}
            amount={unallocated}
            label="unallocated"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Table cells ─────────────────────────────────────────────────────────────────

function scoreBandColor(score: number) {
  if (score >= 80) return C.success
  if (score >= 60) return C.amber
  return C.danger
}

function AiScoreCell({
  status,
  score,
}: {
  status: string | null | undefined
  score: number | null | undefined
}) {
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

// A tick means "checked and clear" — so a warning must not wear one. Anything the
// registry checks flagged gets the alert triangle; only `clear` gets the tick.
const DD_ICON: Record<string, { icon: typeof CheckmarkCircle02Icon; color: string } | null> = {
  clear: { icon: CheckmarkCircle02Icon, color: C.success },
  warning: { icon: Alert02Icon, color: C.amber },
  blocked: { icon: Alert02Icon, color: C.danger },
  review: { icon: CancelCircleIcon, color: C.faint },
  pending: null,
}

function DueDiligenceCell({ status }: { status: DueDiligenceStatus }) {
  const d = DD_ICON[status]
  return (
    <div className="flex justify-center">
      {d ? (
        <HugeiconsIcon icon={d.icon} size={20} color={d.color} />
      ) : (
        <span className="block size-5 rounded-full border" style={{ borderColor: C.line }} />
      )}
    </div>
  )
}

type AppRow = ReturnType<typeof Route.useLoaderData>['items'][number]

// Column ids double as sort keys — DataTable hands the clicked id straight to `setSort`.
const APPLICATION_COLUMNS: TableColumn<AppRow>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    sortable: true,
    cell: (app) => {
      const type = app.charityNumber ? 'Reg. charity' : app.companyNumber ? 'Company' : null
      const area = app.deliveryRegion ?? app.deliveryArea ?? null
      const subline = [type, area, app.externalApplicationId].filter(Boolean).join(' · ') || '—'
      return (
        <div className="flex items-center gap-2">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: C.wash }}
          >
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
      )
    },
  },
  {
    id: 'amount',
    header: 'Amount',
    width: 'sm:w-[130px]',
    sortable: true,
    cell: (app) => (
      <span className="font-display text-[14px] font-medium tabular-nums" style={{ color: C.ink }}>
        {fmtAmount(app.amountRequested)}
      </span>
    ),
  },
  {
    id: 'programme',
    hideBelow: 'lg',
    header: 'Programme',
    width: 'sm:w-[200px]',
    cell: (app) => (
      <span className="font-display text-[14px]" style={{ color: C.ink }}>
        {app.roundProgramme?.programme?.name ?? '—'}
      </span>
    ),
  },
  {
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[160px]',
    cell: (app) => {
      const themes = (app.roundProgramme?.programme?.tags as string[] | null) ?? []
      if (themes.length === 0) {
        return (
          <span className="font-display text-[14px]" style={{ color: C.faint }}>
            —
          </span>
        )
      }
      return (
        <span className="font-display text-[14px]" style={{ color: C.sub }}>
          {themes[0]}
          {themes.length > 1 && <span style={{ color: C.faint }}> +{themes.length - 1}</span>}
        </span>
      )
    },
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[130px]',
    sortable: true,
    cell: (app) => {
      const s = STATUS_PILL[app.status] ?? { label: app.status, color: C.sub }
      return <StatusPill label={s.label} color={s.color} />
    },
  },
  {
    id: 'score',
    hideBelow: 'md',
    header: 'AI score',
    width: 'sm:w-[110px]',
    sortable: true,
    cell: (app) => <AiScoreCell status={app.custodianScoreStatus} score={app.custodianScore} />,
  },
  {
    id: 'dueDiligence',
    hideBelow: 'xl',
    header: 'Due diligence',
    width: 'sm:w-[120px]',
    sortable: true,
    cell: (app) => (
      <DueDiligenceCell status={(app.dueDiligenceStatus ?? 'pending') as DueDiligenceStatus} />
    ),
  },
]

// Bulk status action for the selected rows. An action menu (not a filter) — it never
// reflects a value; picking an option applies it and resets. "Awarded" is intentionally
// absent: awarding runs through the dedicated grant flow, not a status flip.
type SettableStatus = Exclude<ApplicationStatus, 'awarded'>

function BulkStatusMenu({ busy, onPick }: { busy: boolean; onPick: (s: SettableStatus) => void }) {
  return (
    <div className="relative shrink-0">
      <div className="flex h-8 items-center gap-1 rounded-md bg-white pl-3 pr-2">
        <span
          className="whitespace-nowrap font-display text-[14px] font-medium"
          style={{ color: C.ink }}
        >
          {busy ? 'Updating…' : 'Change status'}
        </span>
        <HugeiconsIcon icon={ArrowRight01Icon} size={16} color={C.ink} />
      </div>
      <select
        aria-label="Change status of selected applications"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value as SettableStatus)
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

// ─── Screen ──────────────────────────────────────────────────────────────────────

function ApplicationsList() {
  const navigate = useNavigate({ from: '/applications/' })
  const router = useRouter()
  const search = Route.useSearch()
  const { roundId, programmeId, status, scoreBand, tag, q, from, to, sortBy, sortDir, page } =
    search
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
  }, [roundId, programmeId, status, scoreBand, tag, q, from, to, page])

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
    roundStatus === 'open'
      ? 'Current round'
      : roundStatus === 'closed'
        ? 'Closed'
        : roundStatus
          ? 'Upcoming'
          : null

  // Distinct themes (tags) across the round's programmes, for the Theme filter.
  const tags = [...new Set(budgetSummary.flatMap((r) => r.tags))].sort()

  // Programme (the primary browsing axis), with per-programme counts.
  const programmeOptions = budgetSummary.map((r) => ({
    value: r.programmeId,
    label: `${r.programmeName} (${r.total})`,
  }))

  // There is deliberately no "all programmes": this screen's budget card, its export
  // scope and its totals are all one programme's, and summing them across programmes
  // says nothing a grants officer can act on — the same reason `RoundSelect` offers no
  // "all rounds". So when the param is absent, settle on the first programme rather
  // than render a selector with nothing named in it. `replace` keeps the back button
  // from bouncing between the bare URL and this one.
  useEffect(() => {
    if (programmeId || programmeOptions.length === 0) return
    navigate({
      search: (prev) => ({ ...prev, programmeId: programmeOptions[0]!.value, page: undefined }),
      replace: true,
    })
  }, [programmeId, programmeOptions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scoped to the selected programme; the round-wide fallback only covers the render
  // before the effect above lands.
  const scopedBudget = programmeId
    ? budgetSummary.filter((r) => r.programmeId === programmeId)
    : budgetSummary
  const selectedProgrammeName = programmeId
    ? budgetSummary.find((r) => r.programmeId === programmeId)?.programmeName
    : null
  const budgetTitle = selectedProgrammeName ? `${selectedProgrammeName} budget` : 'Programme budget'

  // Round-close meta line.
  const metaLine = (() => {
    const parts = [`${total} application${total !== 1 ? 's' : ''}`]
    if (selectedRound?.closedAt) {
      const days = Math.ceil((new Date(selectedRound.closedAt).getTime() - Date.now()) / 86_400_000)
      if (roundStatus === 'closed' || days < 0) {
        parts.push(
          `closed ${new Date(selectedRound.closedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        )
      } else {
        parts.push(`closes in ${days} day${days !== 1 ? 's' : ''}`)
      }
    }
    return parts.join(' · ')
  })()

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
  function setProgramme(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, programmeId: id, page: undefined }) })
  }
  function setStatus(value: string | undefined) {
    navigate({
      search: (prev) => ({
        ...prev,
        status: (value as ApplicationStatus) || undefined,
        page: undefined,
      }),
    })
  }
  function setTag(value: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, tag: value || undefined, page: undefined }) })
  }
  function setScoreBand(value: string | undefined) {
    navigate({
      search: (prev) => ({
        ...prev,
        scoreBand: (value as ScoreBand) || undefined,
        page: undefined,
      }),
    })
  }
  function goToPage(p: number) {
    navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
  }
  // Click a header: first click sorts by its natural default direction (text asc,
  // numeric/score desc); clicking the active column flips direction.
  function setSort(key: SortKey) {
    const defaultDir: SortDir =
      key === 'organisation' || key === 'status' || key === 'dueDiligence' ? 'asc' : 'desc'
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
    setSelected((prev) =>
      items.every((a) => prev.has(a.id)) ? new Set() : new Set(items.map((a) => a.id)),
    )
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedItems = items.filter((a) => selected.has(a.id))
  const combinedAsk = selectedItems.reduce(
    (s, a) => s + (parseFloat(a.amountRequested ?? '0') || 0),
    0,
  )

  // Bulk status change for the selected rows. Awarded applications are skipped —
  // un-awarding would orphan the award/grant records (that's the award set-up flow).
  async function bulkSetStatus(status: SettableStatus) {
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
      const all = await listApplications({
        data: { page: 1, pageSize: 10_000, roundId, programmeId },
      })
      const scope = programmeId
        ? budgetSummary.find((r) => r.programmeId === programmeId)?.programmeName
        : selectedRound?.name
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
              <RoundSelect
                rounds={visibleRounds}
                value={roundId}
                statusLabel={statusLabel}
                onChange={handleRoundChange}
              />
            )}
            <span
              className="whitespace-nowrap font-display text-[12px] font-medium"
              style={{ color: C.sub }}
            >
              {metaLine}
            </span>
          </div>
          <div
            className="flex h-10 w-full min-w-0 items-center gap-2 rounded-[12px] px-3 sm:w-auto"
            style={{ backgroundColor: C.wash }}
          >
            <HugeiconsIcon icon={Search01Icon} size={16} color={C.sub} />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search organisation or ID…"
              className="w-full min-w-0 bg-transparent font-display text-[14px] outline-hidden placeholder:text-[#637083] sm:w-52"
              style={{ color: C.ink }}
            />
          </div>
        </div>
      </div>

      {/* Everything below the header is one card: what you are looking at
          (programme), what it costs (budget), how you narrow it (filters), the
          rows themselves, and — only while rows are selected — what you can do
          to them. */}
      <div
        className="flex flex-col gap-4 rounded-[16px] border bg-white p-4"
        style={{ borderColor: C.line }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {programmeOptions.length > 0 && (
            <SelectPill
              size="sm"
              ariaLabel="Programme"
              label="Programme"
              options={programmeOptions}
              value={programmeId}
              onChange={(v) => setProgramme(v || undefined)}
            />
          )}
          <div className="ml-auto">
            <ExportButton onClick={handleExport} busy={exporting} />
          </div>
        </div>

        {/* Budget for the selected programme */}
        {scopedBudget.length > 0 && <BudgetCard rows={scopedBudget} title={budgetTitle} />}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Status"
            value={status}
            options={APPLICATION_STATUS_OPTIONS}
            onChange={setStatus}
          />
          {tags.length > 0 && (
            <FilterPill
              label="Theme"
              value={tag}
              options={tags.map((t) => ({ value: t, label: t }))}
              onChange={setTag}
            />
          )}
          <FilterPill
            label="AI score"
            value={scoreBand}
            options={SCORE_BAND_OPTIONS}
            onChange={setScoreBand}
          />
          <DateRangePicker
            value={{ from, to }}
            onChange={(next) =>
              navigate({
                search: (prev) => ({ ...prev, from: next.from, to: next.to, page: undefined }),
              })
            }
            allLabel="Any date"
          />
        </div>

        <div className="overflow-hidden rounded-[12px] border" style={{ borderColor: C.line }}>
          <DataTable
            columns={APPLICATION_COLUMNS}
            rows={items}
            rowKey={(app) => app.id}
            onRowClick={(app) =>
              navigate({ to: '/applications/$applicationId', params: { applicationId: app.id } })
            }
            sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : undefined}
            onSort={(id) => setSort(id as SortKey)}
            selection={{
              isSelected: (app) => selected.has(app.id),
              toggle: (app) => toggleOne(app.id),
              allSelected,
              toggleAll,
            }}
            empty={
              <div className="p-4">
                <EmptyState>
                  <p className="font-display text-[14px]" style={{ color: C.sub }}>
                    No applications match these filters.
                  </p>
                </EmptyState>
              </div>
            }
          />
        </div>

        {/* Selection toolbar — sits under the table, beside the rows it acts on */}
        {selected.size > 0 && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-2"
            style={{ backgroundColor: C.bar }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-white/10 pl-1.5 pr-2 font-display text-[14px] font-medium text-white"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} color="#fff" />
                Clear
              </button>
              <span className="font-display text-[12px] font-medium" style={{ color: C.mint }}>
                {selected.size} selected · {fmtAmount(combinedAsk)} combined ask
              </span>
            </div>
            <BulkStatusMenu busy={busy} onPick={bulkSetStatus} />
          </div>
        )}

        {total > 0 && (
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            shown={items.length}
            total={total}
            noun="applications"
            onChange={goToPage}
          />
        )}
      </div>
    </div>
  )
}
