import { Fragment, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Coins01Icon,
  UserGroupIcon,
  Location01Icon,
  ChartAverageIcon,
  ArrowRight01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import {
  DateRangePicker,
  EmptyState,
  ExportButton,
  FilterPill,
  MiniKpi,
  formatDateRange,
} from '../../components/ui'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import {
  Choropleth,
  MapAttribution,
  useAreaNames,
  type MapView,
} from '../../components/charts/Choropleth'
import { DotGrid } from '../../components/charts/DotGrid'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { getInsights, type InsightsGrant } from '../../server/fns/insights'
import { exportInsightsPdf } from '../../lib/exportInsightsPdf'
import { fmtCompact, fmtMoney } from '../../lib/format'

// Insights: portfolio analysis over every awarded grant. Everything on this
// screen is computed — from grant amounts, resolved deprivation deciles, and the
// impact figures the report-analysis pipeline has already extracted and stored.
// No screen-time AI: where a number's coverage is partial the denominator is stated.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/** Location-filter sentinel for grants with no resolvable delivery area. */
const NO_REGION = 'none'

type InsightsSearch = {
  /** Inclusive decision-date window (`yyyy-mm-dd`); absent = all time. */
  from?: string
  to?: string
  programmeId?: string
  tag?: string
  region?: string
}

export const Route = createFileRoute('/_authenticated/insights')({
  validateSearch: (search: Record<string, unknown>): InsightsSearch => ({
    from: typeof search.from === 'string' && ISO_DAY.test(search.from) ? search.from : undefined,
    to: typeof search.to === 'string' && ISO_DAY.test(search.to) ? search.to : undefined,
    programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
    tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
    region: typeof search.region === 'string' && search.region ? search.region : undefined,
  }),
  loader: async () => getInsights(),
  component: InsightsPage,
})

// ─── Design tokens ───────────────────────────────────────────────────────────────
const C = {
  ink: '#141C24',
  sub: '#637083',
  faint: '#97A1AF',
  line: '#E4E7EC',
  wash: '#F2F4F7',
  brand: '#1F7A5C',
  success: '#31A650',
}
const KPI = {
  committed: { bg: '#F5F4FF', accent: '#8B7FF0' },
  people: { bg: '#EDF9F1', accent: '#31A650' },
  reach: { bg: '#FEF7EB', accent: '#F89828' },
  avg: { bg: '#FDEFF2', accent: '#F0537A' },
}
const PALETTE = ['#31A650', '#4FA8E8', '#F48FB1', '#F5B851', '#8B7FF0', '#4FBEE8', '#F0876B']
// Rotating pastel tints for the round grant cards.
const CARD_TINTS = [
  { bg: '#F5F4FF', ink: '#6E63D6' },
  { bg: '#EDF9F1', ink: '#1F7A5C' },
  { bg: '#FEF7EB', ink: '#B4741A' },
  { bg: '#FDEFF2', ink: '#C64B72' },
  { bg: '#EEF7FC', ink: '#2F7CB8' },
]

// ─── Formatting ──────────────────────────────────────────────────────────────────

// Count-up for the headline stats (SSR-safe; sits still under reduced motion).
function useCountUp(target: number, duration = 450): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const next = from + (target - from) * eased
      setValue(next)
      fromRef.current = next
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

// ─── Primitives ──────────────────────────────────────────────────────────────────

function Panel({
  children,
  className = '',
  innerRef,
  ...rest
}: {
  children: React.ReactNode
  className?: string
  innerRef?: React.Ref<HTMLDivElement>
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      ref={innerRef}
      className={`rounded-[16px] border bg-white p-4 ${className}`}
      style={{ borderColor: C.line }}
      {...rest}
    >
      {children}
    </div>
  )
}

function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
      <h2 className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

// A borderless stat (used inside a titled panel).
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="font-display text-[13px] font-medium" style={{ color: C.sub }}>
        {label}
      </p>
      <p
        className="mt-1 font-display text-[24px] font-semibold leading-none"
        style={{ color: C.ink }}
      >
        {value}
      </p>
      <p className="mt-1 font-display text-[12px]" style={{ color: C.faint }}>
        {sub}
      </p>
    </div>
  )
}

// Column chart of funding across IMD deciles 1–10. Deciles 1–4 (the "most deprived
// 40%") carry the accent; 5–10 recede.
function DecileChart({ amounts, total, max }: { amounts: number[]; total: number; max: number }) {
  return (
    <div>
      <div className="relative mt-2 h-40">
        <DotGrid />
        <div className="relative flex h-full items-end gap-2">
          {amounts.map((amt, i) => {
            const pct = total > 0 ? Math.round((amt / total) * 100) : 0
            const h = Math.round((amt / max) * 100)
            return (
              <div
                key={i}
                className="group flex h-full flex-1 flex-col justify-end"
                title={`Decile ${i + 1} · ${fmtMoney(amt)} · ${pct}%`}
              >
                {amt > 0 && pct >= 4 && (
                  <span
                    className="mb-1 text-center font-display text-[12px]"
                    style={{ color: C.faint }}
                  >
                    {pct}%
                  </span>
                )}
                <div
                  className="mx-auto w-full max-w-[26px] rounded-t-md"
                  style={{
                    height: `${Math.max(amt > 0 ? 3 : 0, h)}%`,
                    backgroundColor: i < 4 ? C.brand : withAlpha(C.success, 0.2),
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-2">
        {amounts.map((_, i) => (
          <span
            key={i}
            className="flex-1 text-center font-display text-[12px]"
            style={{ color: C.sub }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span
          className="flex items-center gap-1.5 font-display text-[12px]"
          style={{ color: C.sub }}
        >
          <span className="size-2 rounded-[2px]" style={{ backgroundColor: C.brand }} /> Most
          deprived 40%
        </span>
        <span
          className="flex items-center gap-1.5 font-display text-[12px]"
          style={{ color: C.sub }}
        >
          <span
            className="size-2 rounded-[2px]"
            style={{ backgroundColor: withAlpha(C.success, 0.2) }}
          />{' '}
          Deciles 5–10
        </span>
      </div>
    </div>
  )
}

// Commitment over time (Figma 128:42632 / 434:26775): the same per-round series in
// two readings — Bars for "what did each round commit", Line for the shape of the
// trend. Both sit on the shared dot-matrix backdrop with a 5-tick money axis.
const PLOT_H = 206
const AXIS_W = 40

function CommitmentChart({
  mode,
  series,
  max,
  ticks,
}: {
  mode: 'bars' | 'line'
  series: Array<{ id: string; label: string; value: number }>
  max: number
  ticks: number[]
}) {
  // Points are placed at band centres so the line and the bars share an x scale.
  const step = 100 / series.length
  const pts = series.map((p, i) => ({
    ...p,
    x: step * (i + 0.5),
    y: 100 - (p.value / max) * 100,
  }))

  return (
    <div>
      <div className="flex" style={{ height: PLOT_H }}>
        <div className="flex flex-col justify-between pr-2 text-right" style={{ width: AXIS_W }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="font-display text-[12px] leading-none"
              style={{ color: C.faint }}
            >
              {t === 0 ? '0' : fmtCompact(t).replace('£', '')}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          <DotGrid />
          {mode === 'bars' ? (
            <div className="relative flex h-full items-end">
              {series.map((p) => {
                const h = (p.value / max) * 100
                return (
                  <div
                    key={p.id}
                    className="flex h-full flex-1 items-end justify-center"
                    title={`${p.label} · ${fmtMoney(p.value)}`}
                  >
                    <div
                      className="w-8 rounded-t-md"
                      style={{ height: `${Math.max(1, h)}%`, backgroundColor: '#8B7FF0' }}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="relative h-full w-full">
              {/* The path is drawn in a stretched 100×100 space; the markers are
                  plain elements positioned over it, so they stay circular. */}
              <svg
                className="block h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path
                  d={smoothPath(pts)}
                  fill="none"
                  stroke="#8B7FF0"
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {pts.map((p) => (
                <span
                  key={p.id}
                  title={`${p.label} · ${fmtMoney(p.value)}`}
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white"
                  style={{ left: `${p.x}%`, top: `${p.y}%`, borderColor: '#8B7FF0' }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex" style={{ paddingLeft: AXIS_W }}>
        {series.map((p) => (
          <div key={p.id} className="min-w-0 flex-1 px-1 text-center">
            {mode === 'line' && (
              <p className="truncate font-display text-[14px] font-medium" style={{ color: C.ink }}>
                {fmtCompact(p.value)}
              </p>
            )}
            <p
              className="truncate font-display text-[12px]"
              style={{ color: C.sub }}
              title={p.label}
            >
              {p.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Catmull-Rom → cubic bézier: the design's eased curve through every point. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

// ─── Derivations (pure, over the filtered grant set) ─────────────────────────────

// The ranked area list beside the map (Figma 434:37506).
//
// It earns its space by doing three jobs the map cannot. It *ranks* — a
// choropleth can't, because the quantile buckets deliberately compress a skewed
// distribution, so two regions an order of magnitude apart can share a colour.
// It is the donut's legend, carrying the same palette swatch, without which the
// ring beside it is an unreadable set of anonymous arcs. And it is the click
// target for areas too small to hit on the map — at world level that is most of
// them, and at district level it is every inner-London borough.
//
// Rows behave exactly like the map: one click selects *and* drills where a
// level exists beneath. Two different rules for the same act, on the same
// panel, would be the worse outcome.
function AreaList({
  areas,
  total,
  rest,
  selected,
  drillable,
  onPick,
  highlight,
  onHighlight,
}: {
  areas: Array<{ code: string; name: string; amount: number; count: number; color: string }>
  total: number
  /** The tail the donut folds into one neutral arc; 0 to omit. Carried here
   *  because that arc is otherwise an unlabelled grey wedge. */
  rest: number
  selected: string | null
  /** Whether this tier has a level beneath it — chevrons and drilling. */
  drillable: boolean
  onPick: (code: string, name: string) => void
  /** Area held at full strength while the rest recede. */
  highlight: string | null
  onHighlight: (code: string | null) => void
}) {
  return (
    <ul className="flex flex-col gap-0.5" onMouseLeave={() => onHighlight(null)}>
      {areas.map((a) => {
        const on = selected === a.code
        const pct = total > 0 ? Math.round((a.amount / total) * 100) : 0
        const dim = highlight !== null && highlight !== a.code
        return (
          <li key={a.code}>
            <button
              type="button"
              onClick={() => onPick(a.code, a.name)}
              onMouseEnter={() => onHighlight(a.code)}
              onFocus={() => onHighlight(a.code)}
              onBlur={() => onHighlight(null)}
              aria-current={on || undefined}
              title={`${a.name} · ${fmtCompact(a.amount)} · ${a.count} grant${a.count !== 1 ? 's' : ''} · ${pct}%`}
              className="flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left"
              style={{
                borderColor: on ? C.brand : 'transparent',
                backgroundColor: on ? '#fff' : highlight === a.code ? C.wash : undefined,
                opacity: dim ? 0.6 : 1,
                transition: 'opacity 200ms ease, background-color 150ms ease',
              }}
            >
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: a.color }}
              />
              <span
                className="min-w-0 flex-1 truncate font-display text-[13px]"
                style={{ color: C.ink }}
              >
                {a.name}
              </span>
              <span
                className="shrink-0 font-display text-[12px] tabular-nums"
                style={{ color: C.sub }}
              >
                {fmtCompact(a.amount)} · {a.count}
              </span>
              {drillable && (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  color={on ? C.brand : C.faint}
                  className="shrink-0"
                />
              )}
            </button>
          </li>
        )
      })}

      {rest > 0 && (
        <li className="flex items-center gap-2.5 px-2.5 py-1.5">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: C.line }} />
          <span
            className="min-w-0 flex-1 truncate font-display text-[13px]"
            style={{ color: C.sub }}
          >
            Other areas
          </span>
          <span
            className="shrink-0 font-display text-[12px] tabular-nums"
            style={{ color: C.faint }}
          >
            {fmtCompact(rest)}
          </span>
        </li>
      )}
    </ul>
  )
}

// Deprivation reach for whatever the map is currently showing.
//
// Scoped to the view rather than the portfolio on purpose: the decile panel
// further down already reports the portfolio-wide picture, so repeating that
// number here would spend a line without adding a fact. Scoped, it answers the
// question the map just raised — you drilled into a region, so how deprived is
// *there*?
//
// UK-only, and not by omission: IMD is a UK index with no meaning in Ukraine or
// Kenya, and deciles are per-nation, which is why the wording says "in its
// nation" rather than implying one UK-wide ranking.
function ImdNote({ pct }: { pct: number }) {
  return (
    <div
      className="flex items-start gap-2 rounded-[10px] px-3 py-2.5"
      style={{ backgroundColor: C.wash }}
    >
      <HugeiconsIcon
        icon={InformationCircleIcon}
        size={16}
        color={C.sub}
        className="mt-px shrink-0"
      />
      <p className="font-display text-[12px] leading-snug" style={{ color: C.sub }}>
        <span style={{ color: C.ink, fontWeight: 500 }}>{pct}%</span> of mapped funding reaches IMD
        deciles 1–2 — the most deprived fifth of areas in its nation.
      </p>
    </div>
  )
}

function decileShare(g: InsightsGrant, maxDecile: number): number {
  if (!g.deprivation) return 0
  const total = g.deprivation.histogram.reduce((s, n) => s + n, 0)
  if (total === 0) return 0
  const inBand = g.deprivation.histogram.slice(0, maxDecile).reduce((s, n) => s + n, 0)
  return inBand / total
}

type ImpactSource = 'reported' | 'proposed'
/**
 * A grant's impact figure, provenance-tagged: the ACTUAL from an analysed report
 * where one exists, otherwise the applicant's PROPOSED figure as a fallback. Callers
 * decide how to present each source — proposed figures are estimates, never actuals.
 */
function effImpact(g: InsightsGrant): { value: number; source: ImpactSource } | null {
  if (g.impactQuantity !== null) return { value: g.impactQuantity, source: 'reported' }
  if (g.proposedImpactQuantity !== null)
    return { value: g.proposedImpactQuantity, source: 'proposed' }
  return null
}
function sumImpact(grants: InsightsGrant[]): number {
  return grants.reduce((s, g) => s + (effImpact(g)?.value ?? 0), 0)
}

/** Round a chart's top gridline up to 1/2/5 × a power of ten, so ticks divide evenly. */
function niceMax(n: number): number {
  const pow = 10 ** Math.floor(Math.log10(n))
  const step = [1, 2, 2.5, 5, 10].find((m) => n <= m * pow) ?? 10
  return step * pow
}

/** "Community & Place + 1 other" — the programmes a theme's grants came from. */
function programmeSummary(names: string[]): string {
  const uniq = [...new Set(names)]
  if (uniq.length === 0) return 'No programme recorded'
  const [first, ...rest] = uniq
  if (rest.length === 0) return first!
  return `${first} + ${rest.length} other${rest.length !== 1 ? 's' : ''}`
}

/** Funding spread across deciles 1–10, weighting each grant's amount by its histogram. */
function fundingByDecile(grants: InsightsGrant[]): number[] {
  const out = Array<number>(10).fill(0)
  for (const g of grants) {
    if (!g.deprivation) continue
    const total = g.deprivation.histogram.reduce((s, n) => s + n, 0)
    if (total === 0) continue
    g.deprivation.histogram.forEach((n, i) => {
      out[i] = (out[i] ?? 0) + g.amountAwarded * (n / total)
    })
  }
  return out
}

function InsightsPage() {
  const navigate = useNavigate({ from: '/insights' })
  const { from, to, programmeId, tag, region } = Route.useSearch()
  const { items } = Route.useLoaderData()

  // ── Filter options, derived from the data itself ──
  const programmes = [
    ...new Map(items.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).values(),
  ]
    .map((g) => ({ id: g.programmeId!, name: g.programmeName ?? '—' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const allTags = [...new Set(items.flatMap((g) => g.tags))].sort()
  const regions = [
    ...new Set(items.map((g) => g.region).filter((r): r is string => Boolean(r))),
  ].sort()
  // Grants whose delivery location never resolved are a real group a reader needs to
  // reach — without an option for them they are simply missing from every location
  // slice, which reads as "we fund nowhere else" rather than "we don't know".
  const hasUnlocated = items.some((g) => !g.region)

  // ── The filtered slice every panel below describes ──
  // The date window is on the award decision — the moment the money was committed,
  // which is what every figure on this screen counts.
  const fil = items.filter((g) => {
    if (programmeId && g.programmeId !== programmeId) return false
    if (tag && !g.tags.includes(tag)) return false
    if (region === NO_REGION ? Boolean(g.region) : region && g.region !== region) return false
    const day = g.decisionAt.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })

  // ── Headline stats ──
  const committed = fil.reduce((s, g) => s + g.amountAwarded, 0)
  const avgGrant = fil.length > 0 ? committed / fil.length : 0
  const amounts = fil.map((g) => g.amountAwarded)
  const minGrant = amounts.length ? Math.min(...amounts) : 0
  const maxGrant = amounts.length ? Math.max(...amounts) : 0

  const selectedProgramme = programmeId ? fil.find((g) => g.programmeId === programmeId) : undefined
  const impactPool = selectedProgramme ? fil : fil.filter((g) => g.unitKey === 'people')
  // Provenance-aware: prefer reported actuals, fall back to proposed. Track the split
  // so estimates are surfaced, never silently passed off as achieved impact.
  const impactEff = impactPool
    .map(effImpact)
    .filter((e): e is { value: number; source: ImpactSource } => e !== null)
  const impactTotal = impactEff.reduce((s, e) => s + e.value, 0)
  const impactReportedCount = impactEff.filter((e) => e.source === 'reported').length
  const impactProposedCount = impactEff.filter((e) => e.source === 'proposed').length
  const impactLabel = selectedProgramme ? selectedProgramme.unitLabel : 'People reached'

  const located = fil.filter((g) => g.deprivation)
  const locatedAmt = located.reduce((s, g) => s + g.amountAwarded, 0)
  const dep14Amt = located.reduce((s, g) => s + g.amountAwarded * decileShare(g, 4), 0)
  const dep14Pct = locatedAmt > 0 ? Math.round((dep14Amt / locatedAmt) * 100) : 0

  const committedUp = useCountUp(committed)
  const impactUp = useCountUp(impactTotal)
  const dep14Up = useCountUp(locatedAmt > 0 ? dep14Pct : 0)
  const avgUp = useCountUp(avgGrant)

  // ── Giving by programme ──
  const byProgramme = [
    ...new Map(fil.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).keys(),
  ]
    .map((pid, i) => {
      const grants = fil.filter((g) => g.programmeId === pid)
      return {
        id: pid,
        name: grants[0]!.programmeName ?? '—',
        color: PALETTE[i % PALETTE.length]!,
        committed: grants.reduce((s, g) => s + g.amountAwarded, 0),
        grants: grants.length,
        people: grants[0]!.unitKey === 'people' ? sumImpact(grants) : null,
        unitLabel: grants[0]!.unitLabel,
      }
    })
    .sort((a, b) => b.committed - a.committed)

  // ── Commitment over time (by round, chronological) ──
  // Bars and Line plot the same series — what each round committed. (A cumulative
  // mode was dropped: a running total answers a different question and read as if
  // the round totals themselves were growing.)
  const [chartMode, setChartMode] = useState<'bars' | 'line'>('bars')
  const timelineRounds = [
    ...new Map(fil.filter((g) => g.roundId).map((g) => [g.roundId!, g])).keys(),
  ]
    .map((rid) => {
      const grants = fil
        .filter((g) => g.roundId === rid)
        .sort((a, b) => b.amountAwarded - a.amountAwarded)
      return {
        id: rid,
        name: grants[0]!.roundName ?? '—',
        openedAt: grants[0]!.roundOpenedAt,
        grants,
        total: grants.reduce((s, g) => s + g.amountAwarded, 0),
      }
    })
    .sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''))
  const commitSeries = timelineRounds.map((r) => ({ id: r.id, label: r.name, value: r.total }))
  // Axis ticks run 0 → a rounded-up maximum, so the gridline labels are readable
  // numbers rather than whatever the tallest bar happens to be.
  const chartMax = niceMax(Math.max(1, ...commitSeries.map((p) => p.value)))
  const chartTicks = [4, 3, 2, 1, 0].map((i) => (chartMax * i) / 4)

  // ── Themes ──
  const tagNames = [...new Set(fil.flatMap((g) => g.tags))].sort()
  const themes = tagNames
    .map((t, i) => {
      const grants = fil.filter((g) => g.tags.includes(t))
      return {
        tag: t,
        color: PALETTE[i % PALETTE.length]!,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        people: sumImpact(grants.filter((g) => g.unitKey === 'people')),
        programmes: programmeSummary(
          grants.map((g) => g.programmeName).filter((n): n is string => Boolean(n)),
        ),
      }
    })
    .sort((a, b) => b.amount - a.amount)
  const themedTotal = themes.reduce((s, t) => s + t.amount, 0)

  // ── Geography: the choropleth + its donut ──
  //
  // The map drills World → United Kingdom → one region's districts. Each level
  // keys on a different field, so the values map is rebuilt per view rather than
  // derived once: countries on ISO alpha-3, regions on the persisted region
  // name, districts on the ONS LAD code.
  const [mapView, setMapView] = useState<MapView>({ kind: 'uk' })
  const [selArea, setSelArea] = useState<string | null>(null)
  // Whichever of the map, donut or list the pointer is over. Hoisted here
  // because the three are one exhibit: pointing at an area in any of them
  // should answer "and where is that in the other two?".
  const [hoverArea, setHoverArea] = useState<string | null>(null)
  const unlocatedCount = fil.filter((g) => !g.region).length

  // Roll grants up to whichever key the current view paints.
  const mapValues = (() => {
    const acc = new Map<string, { amount: number; count: number }>()
    const add = (key: string | null, amount: number) => {
      if (!key) return
      const prev = acc.get(key) ?? { amount: 0, count: 0 }
      acc.set(key, { amount: prev.amount + amount, count: prev.count + 1 })
    }
    for (const g of fil) {
      if (mapView.kind === 'uk') add(g.region, g.amountAwarded)
      else if (mapView.kind === 'region') {
        if (g.region === mapView.region) add(g.ladCode, g.amountAwarded)
      }
      // World and country: nothing to add. Delivery geography is UK-only today
      // — an application records a region and a LAD but no country — so those
      // tiers have no data rather than wrong data. Adding `deliveryCountry`
      // (ISO alpha-3, defaulting to GBR) is what would make them real.
    }
    return acc
  })()

  // Whether the World tier has anything to paint. Zero until a grant carries a
  // country, which is why the breadcrumb doesn't currently offer World: it
  // would lead to a blank planet and read as a broken map.
  const countryCount = mapView.kind === 'world' ? mapValues.size : 0

  // The donut mirrors whatever the map is showing: same slice of the portfolio,
  // ranked, so the two halves of the panel can never disagree.
  const areaRanked = [...mapValues.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.amount - a.amount)
  const areaTotal = areaRanked.reduce((s, a) => s + a.amount, 0)
  const areaNames = useAreaNames(mapView)
  const topAreas = areaRanked.slice(0, PALETTE.length).map((a, i) => ({
    ...a,
    name: areaNames.get(a.code) ?? a.code,
    color: PALETTE[i % PALETTE.length]!,
  }))
  const restAmount = areaRanked.slice(PALETTE.length).reduce((s, a) => s + a.amount, 0)
  const areaDonut: DonutSlice[] = [
    ...topAreas.map((a) => ({ areaId: a.code, name: a.name, value: a.amount, color: a.color })),
    // Never generate an 8th hue — the tail folds into one neutral "Other".
    ...(restAmount > 0
      ? [{ name: 'Other areas', value: restAmount, color: C.line }]
      : []),
  ]

  // IMD reach for the map's current view. Empty outside the UK — the index does
  // not exist there — and empty when nothing in the slice resolved to an area,
  // in which case the note simply doesn't render rather than showing 0%.
  const imdScope =
    mapView.kind === 'uk'
      ? located
      : mapView.kind === 'region'
        ? located.filter((g) => g.region === mapView.region)
        : []
  const imdAmt = imdScope.reduce((s, g) => s + g.amountAwarded, 0)
  const imdPct =
    imdAmt > 0
      ? Math.round(
          (imdScope.reduce((s, g) => s + g.amountAwarded * decileShare(g, 2), 0) / imdAmt) * 100,
        )
      : null

  // ── Deprivation-decile distribution ──
  const decileAmounts = fundingByDecile(located)
  const decileMax = Math.max(1, ...decileAmounts)
  const vintages = [...new Set(located.map((g) => g.deprivation!.vintage))].sort()

  // ── Grantee performance (from analysed reports) ──
  const alignmentScores = fil.map((g) => g.alignmentScore).filter((s): s is number => s !== null)
  const avgAlignment =
    alignmentScores.length > 0
      ? alignmentScores.reduce((s, n) => s + n, 0) / alignmentScores.length
      : null
  const milestones = fil.reduce(
    (acc, g) => ({
      received: acc.received + g.milestones.received,
      onTime: acc.onTime + g.milestones.onTime,
      overdue: acc.overdue + g.milestones.overdue,
    }),
    { received: 0, onTime: 0, overdue: 0 },
  )
  const reportsAnalysed = fil.reduce((s, g) => s + g.reportsAnalysed, 0)

  function setSearch(patch: Partial<InsightsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  // ── PDF export ──
  const exportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const periodLabel = formatDateRange({ from, to })
  const programmeLabel = programmeId
    ? (programmes.find((p) => p.id === programmeId)?.name ?? 'Selected programme')
    : 'All programmes'
  const themeLabel = tag ?? 'All themes'
  const regionLabel = region === NO_REGION ? 'No location recorded' : (region ?? 'All locations')
  async function handleExport() {
    if (!exportRef.current) return
    setExporting(true)
    try {
      await exportInsightsPdf(exportRef.current, {
        title: 'Insights',
        filters: `${periodLabel} · ${programmeLabel} · ${themeLabel} · ${regionLabel}`,
        summary: `${fil.length} award${fil.length !== 1 ? 's' : ''} · ${fmtCompact(committed)} committed`,
        generatedAt: new Date().toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header — the title and the export of exactly what's on screen */}
      <div className="flex flex-wrap justify-between gap-3">
        <h1 className="font-display text-[20px] font-medium">
          <span style={{ color: C.ink }}>The story </span>
          <span style={{ color: C.faint }}>so far</span>
        </h1>
        {fil.length > 0 && (
          <ExportButton
            onClick={handleExport}
            busy={exporting}
            label="Export PDF"
            busyLabel="Preparing…"
          />
        )}
      </div>

      {/* Filters — the slice every panel below describes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* A filter shows as soon as there is anything to pick. Hiding it until
            there were two values meant Location vanished on any portfolio where
            only one delivery area had resolved — which read as the filter not
            existing rather than as the data being thin. */}
        <div className="flex flex-wrap items-center gap-3">
          {programmes.length > 0 && (
            <FilterPill
              label="Programme"
              clearLabel="All programmes"
              value={programmeId}
              options={programmes.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => setSearch({ programmeId: v })}
            />
          )}
          {allTags.length > 0 && (
            <FilterPill
              label="Theme"
              clearLabel="All themes"
              value={tag}
              options={allTags.map((t) => ({ value: t, label: t }))}
              onChange={(v) => setSearch({ tag: v })}
            />
          )}
          {(regions.length > 0 || hasUnlocated) && (
            <FilterPill
              label="Location"
              clearLabel="All locations"
              value={region}
              options={[
                ...regions.map((r) => ({ value: r, label: r })),
                ...(hasUnlocated ? [{ value: NO_REGION, label: 'No location recorded' }] : []),
              ]}
              onChange={(v) => setSearch({ region: v })}
            />
          )}
        </div>
        <DateRangePicker
          value={{ from, to }}
          onChange={(next) => setSearch({ from: next.from, to: next.to })}
        />
      </div>

      {fil.length === 0 ? (
        <EmptyState>
          <p className="font-display text-[14px]" style={{ color: C.sub }}>
            No awards match these filters.
          </p>
          <p className="mt-1 font-display text-[12px]" style={{ color: C.faint }}>
            Insights build up as awards are made and grant reports are analysed.
          </p>
        </EmptyState>
      ) : (
        <div ref={exportRef} className="flex flex-col gap-4">
          {/* KPI cards */}
          <div data-export-block className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniKpi
              size="lg"
              tint={KPI.committed}
              icon={Coins01Icon}
              label="Total committed"
              value={fmtCompact(committedUp)}
              sub={`across ${fil.length} grant${fil.length !== 1 ? 's' : ''}`}
            />
            <MiniKpi
              size="lg"
              tint={KPI.people}
              icon={UserGroupIcon}
              label={impactLabel}
              value={impactEff.length > 0 ? Math.round(impactUp).toLocaleString('en-GB') : '—'}
              sub={
                impactPool.length === 0
                  ? 'no people-measured programmes here'
                  : `${impactReportedCount} reported${impactProposedCount > 0 ? ` · ${impactProposedCount} proposed` : ''}`
              }
            />
            <MiniKpi
              size="lg"
              tint={KPI.reach}
              icon={Location01Icon}
              label="Deprivation reach"
              value={locatedAmt > 0 ? `${Math.round(dep14Up)}%` : '—'}
              sub={locatedAmt > 0 ? 'reached IMD decile 1–4' : 'no resolved locations yet'}
            />
            <MiniKpi
              size="lg"
              tint={KPI.avg}
              icon={ChartAverageIcon}
              label="Average grant"
              value={fmtCompact(avgUp)}
              sub={
                amounts.length
                  ? `${fmtCompact(minGrant)}–${fmtCompact(maxGrant)} range`
                  : 'across filtered awards'
              }
            />
          </div>

          {/* Giving by programme */}
          {byProgramme.length > 0 && (
            <Panel data-export-block>
              <PanelTitle>Giving by programme</PanelTitle>
              {/* Columns are sized by share of the total, so the row reads as one
                  100%-wide bar broken into programmes — and each meter fills its
                  column rather than leaving a fixed grid half-empty. */}
              <div className="flex flex-col gap-5 sm:flex-row sm:gap-0">
                {byProgramme.map((p, i) => {
                  const pct = committed > 0 ? Math.round((p.committed / committed) * 100) : 0
                  return (
                    <Fragment key={p.id}>
                      {i > 0 && (
                        <span
                          aria-hidden
                          className="mx-4 hidden w-px shrink-0 sm:block"
                          style={{ height: 56, backgroundColor: C.line }}
                        />
                      )}
                      <div className="min-w-0" style={{ flex: `${Math.max(pct, 6)} 1 0%` }}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className="font-display text-[20px] font-medium"
                            style={{ color: C.ink }}
                          >
                            {fmtCompact(p.committed)}
                          </span>
                          <span
                            className="font-display text-[14px] font-medium"
                            style={{ color: C.faint }}
                          >
                            {pct}%
                          </span>
                        </div>
                        <BarMeter
                          fill
                          height={24}
                          barWidth={3}
                          className="my-2 w-full"
                          segments={[{ value: 1, color: p.color }]}
                        />
                        <p
                          className="truncate font-display text-[14px] font-medium"
                          style={{ color: C.ink }}
                          title={p.name}
                        >
                          {p.name}
                        </p>
                        <p className="truncate font-display text-[12px]" style={{ color: C.sub }}>
                          {p.grants} grant{p.grants !== 1 ? 's' : ''}
                          {p.people != null && p.people > 0
                            ? ` · ${Math.round(p.people).toLocaleString('en-GB')} ${p.unitLabel.toLowerCase()}`
                            : ''}
                        </p>
                      </div>
                    </Fragment>
                  )
                })}
              </div>
            </Panel>
          )}

          {/* Commitment over time + Themes */}
          <div data-export-block className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel>
              <PanelTitle
                right={
                  <div
                    className="flex items-center gap-0.5 rounded-lg p-0.5"
                    style={{ backgroundColor: C.wash }}
                  >
                    {(['bars', 'line'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setChartMode(m)}
                        className="h-7 rounded-lg px-2 font-display text-[14px] font-medium capitalize"
                        style={
                          chartMode === m
                            ? {
                                backgroundColor: '#fff',
                                border: `1px solid ${C.line}`,
                                color: C.ink,
                              }
                            : { color: C.sub }
                        }
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                }
              >
                Commitment over time
              </PanelTitle>
              {commitSeries.length === 0 ? (
                <p
                  className="py-10 text-center font-display text-[14px]"
                  style={{ color: C.faint }}
                >
                  No dated rounds in this slice.
                </p>
              ) : (
                <>
                  <p className="-mt-2 mb-4 font-display text-[12px]" style={{ color: C.sub }}>
                    By grant round · £ committed
                  </p>
                  <CommitmentChart
                    mode={chartMode}
                    series={commitSeries}
                    max={chartMax}
                    ticks={chartTicks}
                  />
                </>
              )}
            </Panel>

            <Panel>
              <PanelTitle>Themes</PanelTitle>
              {themes.length === 0 ? (
                <p
                  className="py-10 text-center font-display text-[14px]"
                  style={{ color: C.faint }}
                >
                  No programme tags set — add tags to programmes to see themed giving.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {themes.map((t) => {
                    const pct = themedTotal > 0 ? Math.round((t.amount / themedTotal) * 100) : 0
                    return (
                      // A white wrapper card holds the tinted headline and the line
                      // beneath it — which names the programmes the theme spans, so a
                      // theme is never just a percentage with no provenance.
                      <div
                        key={t.tag}
                        className="flex flex-col gap-1 rounded-[16px] border bg-white px-1 pb-2 pt-1"
                        style={{ borderColor: C.line }}
                      >
                        <div
                          className="flex items-center gap-4 rounded-xl p-3"
                          style={{ backgroundColor: withAlpha(t.color, 0.1) }}
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate font-display text-[14px] font-medium"
                              style={{ color: C.ink }}
                              title={t.tag}
                            >
                              {t.tag}
                            </p>
                            <p
                              className="mt-1 truncate font-display text-[12px]"
                              style={{ color: C.sub }}
                            >
                              {t.count} grant{t.count !== 1 ? 's' : ''} · {fmtCompact(t.amount)}
                              {t.people > 0
                                ? ` · ${Math.round(t.people).toLocaleString('en-GB')} people`
                                : ''}
                            </p>
                          </div>
                          <span
                            className="shrink-0 font-display text-[24px] font-medium leading-none"
                            style={{ color: t.color }}
                          >
                            {pct}
                            <span className="text-[16px]" style={{ color: C.faint }}>
                              %
                            </span>
                          </span>
                        </div>
                        <p
                          className="truncate px-3 font-display text-[12px]"
                          style={{ color: C.sub }}
                          title={t.programmes}
                        >
                          {t.programmes}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* Giving by area */}
          {/* Guarded on the slice, NOT on the current view's values: a view with
              nothing to paint (e.g. World, before grants carry a country) must
              render an empty map, never unmount the panel under the user. */}
          {fil.length > 0 && (
            <Panel data-export-block>
              <PanelTitle>Giving by area</PanelTitle>

              {/* The map column is deliberately the narrower of the two. The UK
                  is a portrait shape and the frame is fitted to it, so a wide
                  column buys a very tall panel; a narrow one lets Britain fill
                  its width and keeps the panel the height of the list beside
                  it. */}
              <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)]">
                <div className="flex flex-col">
                  <Choropleth
                    view={mapView}
                    onViewChange={(v) => {
                      setMapView(v)
                      // Zooming to a country keeps it selected, so the donut
                      // beside the map highlights the place you just opened
                      // instead of clearing under you.
                      setSelArea(v.kind === 'country' ? v.code : null)
                    }}
                    values={mapValues}
                    selected={selArea}
                    onSelect={setSelArea}
                    showWorld={countryCount > 0}
                    highlight={hoverArea}
                    onHighlight={setHoverArea}
                  />
                  <MapAttribution view={mapView} />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex justify-center">
                    <Donut
                      data={areaDonut}
                      size={132}
                      thickness={16}
                      highlight={hoverArea}
                      onHighlight={setHoverArea}
                      center={
                        <div className="text-center">
                          <div
                            className="font-display text-[20px] font-medium"
                            style={{ color: C.ink }}
                          >
                            {fmtCompact(areaTotal)}
                          </div>
                          <div className="font-display text-[12px]" style={{ color: C.faint }}>
                            committed
                          </div>
                        </div>
                      }
                    />
                  </div>

                  <AreaList
                    areas={topAreas}
                    total={areaTotal}
                    rest={restAmount}
                    selected={selArea}
                    highlight={hoverArea}
                    onHighlight={setHoverArea}
                    // Only the UK tier has a level beneath it that a list row
                    // can open. Districts are the floor, and the world tier's
                    // rows are countries whose drill target is a zoom the map
                    // owns — offering a chevron there would promise a
                    // breakdown that does not exist.
                    drillable={mapView.kind === 'uk'}
                    onPick={(code, name) => {
                      setSelArea(code)
                      if (mapView.kind === 'uk') setMapView({ kind: 'region', region: name })
                    }}
                  />

                  {imdPct !== null && <ImdNote pct={imdPct} />}

                  {unlocatedCount > 0 && (
                    <p className="font-display text-[12px]" style={{ color: C.faint }}>
                      {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} with no resolvable
                      location.
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {/* Deprivation-decile distribution + grantee performance */}
          <div data-export-block className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel>
              <PanelTitle>Funding by deprivation decile</PanelTitle>
              {locatedAmt === 0 ? (
                <p
                  className="py-10 text-center font-display text-[14px]"
                  style={{ color: C.faint }}
                >
                  No resolved delivery locations in this slice.
                </p>
              ) : (
                <>
                  <p className="-mt-1 mb-1 font-display text-[12px]" style={{ color: C.sub }}>
                    Decile 1 is the most deprived 10% of areas in its nation
                    {vintages.length ? ` · ${vintages.join(', ')}` : ''}
                  </p>
                  <DecileChart amounts={decileAmounts} total={locatedAmt} max={decileMax} />
                  {unlocatedCount > 0 && (
                    <p className="mt-2 font-display text-[11px]" style={{ color: C.faint }}>
                      {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} without a resolvable
                      location excluded.
                    </p>
                  )}
                </>
              )}
            </Panel>

            <Panel>
              <PanelTitle>Grantee performance</PanelTitle>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat
                  label="Promises kept"
                  value={
                    avgAlignment !== null
                      ? `${(Math.round(avgAlignment * 10) / 10).toLocaleString('en-GB')}/10`
                      : '—'
                  }
                  sub={
                    avgAlignment !== null
                      ? `avg alignment · ${alignmentScores.length} report${alignmentScores.length !== 1 ? 's' : ''}`
                      : 'awaits analysed reports'
                  }
                />
                <Stat
                  label="Reporting on time"
                  value={
                    milestones.received > 0
                      ? `${Math.round((milestones.onTime / milestones.received) * 100)}%`
                      : '—'
                  }
                  sub={
                    milestones.received > 0
                      ? `${milestones.onTime} of ${milestones.received} by due date${milestones.overdue > 0 ? ` · ${milestones.overdue} overdue` : ''}`
                      : milestones.overdue > 0
                        ? `${milestones.overdue} overdue`
                        : 'none due yet'
                  }
                />
                <Stat
                  label="Reports analysed"
                  value={reportsAnalysed > 0 ? String(reportsAnalysed) : '—'}
                  sub={`across ${fil.filter((g) => g.reportsAnalysed > 0).length} of ${fil.length}`}
                />
              </div>
            </Panel>
          </div>

          {/* Impact by round */}
          {timelineRounds.length > 0 && (
            <Panel data-export-block>
              <PanelTitle>Impact by round</PanelTitle>
              <div className="flex flex-col gap-5">
                {timelineRounds
                  .slice()
                  .reverse()
                  .map((r, ri) => (
                    <div key={r.id}>
                      <div className="mb-2.5 flex items-center gap-2.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: C.brand }}
                        />
                        <span
                          className="font-display text-[14px] font-medium"
                          style={{ color: C.ink }}
                        >
                          {r.name}
                        </span>
                        <span className="font-display text-[12px]" style={{ color: C.sub }}>
                          {r.grants.length} grant{r.grants.length !== 1 ? 's' : ''} ·{' '}
                          {fmtCompact(r.total)}
                        </span>
                        <span className="h-px flex-1" style={{ backgroundColor: C.line }} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {r.grants.map((g, gi) => (
                          <RoundGrantCard
                            key={g.awardId}
                            grant={g}
                            tint={CARD_TINTS[(ri + gi) % CARD_TINTS.length]!}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

function RoundGrantCard({
  grant: g,
  tint,
}: {
  grant: InsightsGrant
  tint: { bg: string; ink: string }
}) {
  const eff = g.unitKey === 'people' ? effImpact(g) : null
  const detail = [g.programmeName, g.ladName ?? g.region].filter(Boolean).join(' · ')
  return (
    <Link
      to="/applications/$applicationId"
      params={{ applicationId: g.applicationId }}
      className="block rounded-2xl p-4 transition-shadow hover:shadow-xs"
      style={{ backgroundColor: tint.bg }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] font-medium" style={{ color: C.ink }}>
            {g.organisationName}
          </p>
          <p className="font-display text-[12px]" style={{ color: C.sub }}>
            {eff
              ? `${Math.round(eff.value).toLocaleString('en-GB')} ${g.unitLabel.toLowerCase()}${eff.source === 'proposed' ? ' (proposed)' : ''}`
              : 'no report yet'}
          </p>
        </div>
        <span className="shrink-0 font-display text-[18px] font-medium" style={{ color: tint.ink }}>
          {fmtCompact(g.amountAwarded)}
        </span>
      </div>
      {detail && (
        <p
          className="mt-3 truncate font-display text-[12px]"
          style={{ color: C.sub }}
          title={detail}
        >
          {detail}
        </p>
      )}
    </Link>
  )
}
