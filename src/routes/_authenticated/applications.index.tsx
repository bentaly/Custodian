import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  MinusSignCircleIcon,
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
import { APPLICATIONS_DEFAULT_SORT } from '../../server/fns/applications'
import {
  APPLICATION_STATUS_OPTIONS,
  ApplicationStatus,
  applicationStatusLabel,
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
  SearchInput,
  StatusPill,
  RoundSelect,
  SelectPill,
  Tooltip,
  TruncatedList,
  type TableColumn,
} from '../../components/ui'
import { fmtAmount, fmtCompact, fmtDate, fmtRef } from '../../lib/format'
import { C as TOKENS, bandForScore } from '../../components/ui/tokens'
import { longerTimeout } from '../../lib/requestTimeout'

const PAGE_SIZE = 25

// ─── Design tokens (Figma variables — pinned until the token set lands) ──────────
const C = {
  ...TOKENS,
  bar: 'var(--color-grey-900)', // the dark selection bar,
  mint: 'var(--color-brand-light)', // its meta text,
}

type SortKey = 'organisation' | 'amount' | 'received' | 'status' | 'score' | 'dueDiligence'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = [
  'organisation',
  'amount',
  'received',
  'status',
  'score',
  'dueDiligence',
]

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

// Application status → pill colour. Colours follow the Figma table (amber in review,
// green shortlisted, brand-green awarded, red declined). The *label* is not repeated
// here — it comes from `applicationStatusLabel`, so the pill and the filter that
// produced the row can never disagree.
const STATUS_COLOUR: Record<string, string> = {
  for_review: C.amber,
  shortlisted: C.success,
  awarded: C.brand,
  declined: C.danger,
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
    'Received',
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
      // ISO in the CSV, not `12 Mar 2026` — a spreadsheet should sort it as a date.
      a.submittedAt ? new Date(a.submittedAt).toISOString().slice(0, 10) : '',
      a.custodianScoreStatus === 'scored' && a.custodianScore != null ? a.custodianScore : '',
      a.dueDiligenceStatus ?? '',
      applicationStatusLabel(a.status),
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
  colour,
  amount,
  label,
  count,
}: {
  colour: string
  amount: number
  label: string
  count?: number
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2 rounded-swatch" style={{ backgroundColor: colour }} />
      <span className="font-display text-body font-medium" style={{ color: C.faint }}>
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
      className="flex flex-col gap-4 rounded-card border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      <p className="font-display text-title font-medium" style={{ color: C.ink }}>
        {title}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p
            className="font-display text-heading font-medium leading-none"
            style={{ color: C.ink }}
          >
            {fmtCompact(committed)}
          </p>
          <p className="font-display text-body" style={{ color: C.sub }}>
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
                  { value: totalAwarded, colour: C.success },
                  { value: totalShortlisted, colour: withAlpha(C.success, 0.5) },
                  { value: unallocated, colour: withAlpha(C.success, 0.1) },
                ]
              : [{ value: 1, colour: withAlpha(C.success, 0.1) }]
          }
        />

        <div className="flex flex-wrap items-center gap-4">
          <BudgetLegend
            colour={C.success}
            amount={totalAwarded}
            label="awarded"
            count={awardedCount}
          />
          <BudgetLegend
            colour={withAlpha(C.success, 0.5)}
            amount={totalShortlisted}
            label="shortlisted"
            count={shortlistedCount}
          />
          <BudgetLegend
            colour={withAlpha(C.success, 0.1)}
            amount={unallocated}
            label="unallocated"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Table cells ─────────────────────────────────────────────────────────────────

function AiScoreCell({
  status,
  score,
}: {
  status: string | null | undefined
  score: number | null | undefined
}) {
  const has = status === 'scored' && score != null
  const band = has ? bandForScore(score!) : null
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-[3px] w-10 overflow-hidden rounded-full"
        style={{ backgroundColor: band ? withAlpha(band.fill, 0.25) : C.wash }}
      >
        {band && (
          <div
            className="bar-grow absolute left-0 top-0 h-full rounded-full"
            style={{ width: `${Math.min(100, score!)}%`, backgroundColor: band.fill }}
          />
        )}
      </div>
      {has && (
        <span className="font-display text-body font-medium" style={{ color: C.ink }}>
          {score}
        </span>
      )}
    </div>
  )
}

// A tick means "checked and clear" — so a warning must not wear one. Anything the
// registry checks flagged gets the alert triangle; only `clear` gets the tick.
const DD_ICON: Record<string, { icon: typeof CheckmarkCircle02Icon; colour: string } | null> = {
  clear: { icon: CheckmarkCircle02Icon, colour: C.success },
  warning: { icon: Alert02Icon, colour: C.amber },
  blocked: { icon: Alert02Icon, colour: C.danger },
  review: { icon: CancelCircleIcon, colour: C.faint },
  // Its own mark, not review's: nothing was attempted and nothing can be. Muted, because
  // an applicant holding neither number is ordinary — it is a fact about the submission,
  // not a flag against the organisation.
  no_registration: { icon: MinusSignCircleIcon, colour: C.faint },
  pending: null,
}

/**
 * A column of bare marks with no legend, so each one has to say what it means where it
 * is. Every status carries a name (the tooltip's accessible name, which is what a
 * screen reader reads for the cell) and a sentence saying what it means and what the
 * mark asks of you — six statuses share five glyphs across three colours, and "amber
 * triangle" is not self-evident.
 */
const DD_MEANING: Record<string, { name: string; detail: string }> = {
  clear: {
    name: 'Due diligence clear',
    detail: 'Every registry check passed.',
  },
  warning: {
    name: 'Due diligence warnings',
    detail: 'Some checks flagged something worth being aware of.',
  },
  blocked: {
    name: 'Due diligence blocked',
    detail: 'A check failed in a way that should stop a grant.',
  },
  review: {
    name: 'Due diligence needs a manual check',
    detail: 'The registers could not answer, please manually check.',
  },
  no_registration: {
    name: 'Not screened — no registration number',
    // No instruction: adding a number is admin-only (`rerunDueDiligence`), and this
    // column is read by trustees too. Say what is true for everyone; the application
    // screen offers the fix to the people who have it.
    detail: 'No charity or company number was captured, so there is no register to check against.',
  },
  pending: {
    name: 'Not screened yet',
    detail: 'Screening has not run for this application.',
  },
}

// A `title` attribute would be the cheap version of this and is not good enough: it is
// unreachable by touch, appears after a delay nobody controls, and most screen readers
// ignore it. `Tooltip` is a real focusable button with `aria-describedby`, so the
// explanation reaches a keyboard and a screen reader too.
function DueDiligenceCell({ status }: { status: DueDiligenceStatus }) {
  const d = DD_ICON[status]
  const meaning = DD_MEANING[status] ?? DD_MEANING.pending!
  return (
    <div className="flex justify-center">
      <Tooltip
        label={meaning.name}
        triggerClassName="flex rounded-full focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
        trigger={
          d ? (
            <HugeiconsIcon icon={d.icon} size={20} color={d.colour} />
          ) : (
            <span className="block size-5 rounded-full border" style={{ borderColor: C.line }} />
          )
        }
      >
        <span className="block font-medium text-grey-900">{meaning.name}</span>
        <span className="mt-0.5 block">{meaning.detail}</span>
      </Tooltip>
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
      // The ref is LABELLED (`Ref A-1234`) rather than bare: read after a charity type
      // and a region, an unlabelled code is taken for one more of them. Same wording as
      // search, and as the sublines this fact now carries on Awards, Finance and Reports.
      const subline =
        [type, area, fmtRef(app.externalApplicationId)].filter(Boolean).join(' · ') || '—'
      return (
        <div className="flex items-center gap-2">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-chip"
            style={{ backgroundColor: C.wash }}
          >
            <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
              {initials(app.organisationName)}
            </span>
          </div>
          <div className="min-w-0">
            <Link
              to="/applications/$applicationId"
              params={{ applicationId: app.id }}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-display text-body font-medium hover:underline"
              style={{ color: C.ink }}
            >
              {app.organisationName}
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
    id: 'amount',
    header: 'Amount',
    width: 'sm:w-[130px]',
    sortable: true,
    cell: (app) => (
      <span className="font-display text-body font-medium tabular-nums" style={{ color: C.ink }}>
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
      <span className="font-display text-body" style={{ color: C.ink }}>
        {app.roundProgramme?.programme?.name ?? '—'}
      </span>
    ),
  },
  {
    id: 'theme',
    hideBelow: 'xl',
    header: 'Theme',
    width: 'sm:w-[160px]',
    // Every theme, clipped to the column, with the rest on hover — not "Environment +2",
    // which threw away the names at widths where they fitted and left "+2" meaning
    // nothing in particular. See `ui/TruncatedText`.
    cell: (app) => (
      <TruncatedList
        items={(app.roundProgramme?.programme?.tags as string[] | null) ?? []}
        label="Themes for this programme"
        className={`font-display text-body ${
          ((app.roundProgramme?.programme?.tags as string[] | null) ?? []).length > 0
            ? 'text-grey-500'
            : 'text-grey-400'
        }`}
      />
    ),
  },
  {
    // `submittedAt` is when the submission reached us, not a date the applicant typed —
    // same timestamp, same word, as the Reports table's "Received".
    id: 'received',
    hideBelow: 'lg',
    header: 'Received',
    width: 'sm:w-[130px]',
    sortable: true,
    cell: (app) => (
      <span className="whitespace-nowrap font-display text-body" style={{ color: C.sub }}>
        {fmtDate(app.submittedAt)}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[130px]',
    sortable: true,
    cell: (app) => {
      return (
        <StatusPill
          label={applicationStatusLabel(app.status)}
          colour={STATUS_COLOUR[app.status] ?? C.sub}
        />
      )
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
    // Opening the mark to read what it means must not also open the application.
    stopRowClick: true,
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
      <div className="flex h-8 items-center gap-1 rounded-chip bg-white pl-3 pr-2">
        <span
          className="whitespace-nowrap font-display text-body font-medium"
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
  const { user } = Route.useRouteContext()

  // The ONLY thing selecting rows does here is bulk `updateApplicationStatus`, which is
  // admin-only on the server. So a trustee gets no checkbox column at all rather than a
  // selection that can only lead to "You do not have access to that".
  const canSetStatus = user.role === 'admin' || user.role === 'superadmin'

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

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

  // Themes across the round's programmes, counted the way every other filter row counts
  // its options — a theme's count is the applications sitting in the programmes carrying
  // it, which is what the pill would show you if you picked it.
  const tagCounts = new Map<string, number>()
  for (const r of budgetSummary) {
    for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + r.total)
  }
  const tags = [...tagCounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => ({ value, label: `${value} (${count})` }))

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
          // Day and month only — the year is noise in "closed 5 Mar" — but UTC like every
          // other date, so it cannot disagree with the round's date shown elsewhere.
          `closed ${new Date(selectedRound.closedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
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
  const someSelected = items.some((a) => selected.has(a.id))
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
        // Up to 10,000 rows in one read — longer than the wrapper's default deadline.
        headers: longerTimeout(60_000),
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
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
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
              className="whitespace-nowrap font-display text-label font-medium"
              style={{ color: C.sub }}
            >
              {metaLine}
            </span>
          </div>
          <SearchInput
            value={q}
            onChange={(next) =>
              navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }) })
            }
            placeholder="Search organisation or ID…"
          />
        </div>
      </div>

      {/* Everything below the header is one card: what you are looking at
          (programme), what it costs (budget), how you narrow it (filters), the
          rows themselves, and — only while rows are selected — what you can do
          to them. */}
      <div
        className="flex flex-col gap-4 rounded-card border bg-white p-4"
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

        {/* Filters — the shared row, in the shared order (see `ui/FilterPill`). Programme
            is the exception that sits above rather than in it: on this screen it is the
            browsing axis the budget card and the export are scoped to, not one narrowing
            among several. */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Status"
            plural="statuses"
            value={status}
            options={APPLICATION_STATUS_OPTIONS}
            onChange={setStatus}
          />
          <FilterPill label="Theme" plural="themes" value={tag} options={tags} onChange={setTag} />
          <FilterPill
            label="AI score"
            plural="scores"
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

        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
          <DataTable
            columns={APPLICATION_COLUMNS}
            rows={items}
            rowKey={(app) => app.id}
            onRowClick={(app) =>
              navigate({ to: '/applications/$applicationId', params: { applicationId: app.id } })
            }
            // Never `undefined`: with no explicit sort the list IS ordered — by the
            // server's default — so the header shows that column's arrow rather than
            // implying the rows arrived in no order at all.
            sort={sortBy ? { by: sortBy, dir: sortDir ?? 'asc' } : APPLICATIONS_DEFAULT_SORT}
            onSort={(id) => setSort(id as SortKey)}
            selection={
              canSetStatus
                ? {
                    isSelected: (app) => selected.has(app.id),
                    toggle: (app) => toggleOne(app.id),
                    allSelected,
                    someSelected,
                    toggleAll,
                  }
                : undefined
            }
            empty={
              <div className="p-4">
                <EmptyState>
                  <p className="font-display text-body" style={{ color: C.sub }}>
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
            className="flex flex-wrap items-center justify-between gap-3 rounded-chip p-2"
            style={{ backgroundColor: C.bar }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="flex h-8 shrink-0 items-center gap-1 rounded-chip bg-white/10 pl-1.5 pr-2 font-display text-body font-medium text-white"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} color="#fff" />
                Clear
              </button>
              <span className="font-display text-label font-medium" style={{ color: C.mint }}>
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
