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
  Tooltip,
  TruncatedList,
  TruncatedText,
  formatDateRange,
} from '../../components/ui'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import {
  Choropleth,
  MapAttribution,
  UK_ISO3,
  drillTarget,
  useAreaNames,
  type MapView,
} from '../../components/charts/Choropleth'
import { DotGrid } from '../../components/charts/DotGrid'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { getInsights, type InsightsGrant } from '../../server/fns/insights'
import { exportInsightsPdf } from '../../lib/exportInsightsPdf'
import { fmtCompact, fmtMoney } from '../../lib/format'
import { C, PROGRAMME_COLOURS } from '../../components/ui/tokens'

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
const KPI = {
  committed: {
    bg: 'color-mix(in srgb, var(--color-accent-violet) 10%, transparent)',
    accent: 'var(--color-accent-violet)',
  },
  people: {
    bg: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
    accent: 'var(--color-success)',
  },
  reach: {
    bg: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
    accent: 'var(--color-warning)',
  },
  avg: {
    bg: 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
    accent: 'var(--color-danger)',
  },
}
const PALETTE = PROGRAMME_COLOURS

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
      className={`rounded-card border bg-white p-4 ${className}`}
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
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
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
              // The money behind a column is nowhere else on the screen — only the
              // percentage is, and only above the taller ones — so the column has to
              // hand it over. `Tooltip` rather than a `title` because a bar a keyboard
              // user cannot reach is a bar whose value they never learn.
              <Tooltip
                key={i}
                label={`Decile ${i + 1}`}
                className="flex h-full flex-1"
                triggerClassName="group flex h-full w-full flex-col justify-end rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
                trigger={
                  <>
                    {amt > 0 && pct >= 4 && (
                      <span
                        className="mb-1 text-center font-display text-label"
                        style={{ color: C.faint }}
                      >
                        {pct}%
                      </span>
                    )}
                    <div
                      className="mx-auto w-full max-w-[26px] rounded-t-chip"
                      style={{
                        height: `${Math.max(amt > 0 ? 3 : 0, h)}%`,
                        backgroundColor: i < 4 ? C.brand : withAlpha(C.success, 0.2),
                      }}
                    />
                  </>
                }
              >
                Decile {i + 1} · {fmtMoney(amt)} · {pct}%
              </Tooltip>
            )
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-2">
        {amounts.map((_, i) => (
          <span
            key={i}
            className="flex-1 text-center font-display text-label"
            style={{ color: C.sub }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span
          className="flex items-center gap-1.5 font-display text-label"
          style={{ color: C.sub }}
        >
          <span className="size-2 rounded-swatch" style={{ backgroundColor: C.brand }} /> Most
          deprived 40%
        </span>
        <span
          className="flex items-center gap-1.5 font-display text-label"
          style={{ color: C.sub }}
        >
          <span
            className="size-2 rounded-swatch"
            style={{ backgroundColor: withAlpha(C.success, 0.2) }}
          />{' '}
          Deciles 5–10
        </span>
      </div>
    </div>
  )
}

// Commitment over time (Figma 128:42632 / 434:26775): the same per-round series in
// two readings — Line (the default) for the shape of the trend, Bars for "what did
// each round commit". Both sit on the shared dot-matrix backdrop with a 5-tick money
// axis.
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
              className="font-display text-label leading-none"
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
                  <Tooltip
                    key={p.id}
                    label={p.label}
                    className="flex h-full flex-1"
                    triggerClassName="flex h-full w-full items-end justify-center rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
                    trigger={
                      <div
                        className="w-8 rounded-t-chip"
                        style={{
                          height: `${Math.max(1, h)}%`,
                          backgroundColor: 'var(--color-accent-violet)',
                        }}
                      />
                    }
                  >
                    {p.label} · {fmtMoney(p.value)}
                  </Tooltip>
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
                  stroke="var(--color-accent-violet)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {pts.map((p) => (
                <span
                  key={p.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                >
                  <Tooltip
                    label={p.label}
                    triggerClassName="flex rounded-full focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
                    trigger={
                      <span
                        className="block size-2.5 rounded-full border-2 bg-white"
                        style={{ borderColor: 'var(--color-accent-violet)' }}
                      />
                    }
                  >
                    {p.label} · {fmtMoney(p.value)}
                  </Tooltip>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex" style={{ paddingLeft: AXIS_W }}>
        {series.map((p) => (
          <div key={p.id} className="min-w-0 flex-1 px-1 text-center">
            {mode === 'line' && (
              <p className="truncate font-display text-body font-medium" style={{ color: C.ink }}>
                {fmtCompact(p.value)}
              </p>
            )}
            <div className="font-display text-label" style={{ color: C.sub }}>
              <TruncatedText text={p.label} label="Full label" className="text-center" />
            </div>
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
  drillOf,
  onPick,
  highlight,
  onHighlight,
}: {
  areas: Array<{ code: string; name: string; amount: number; count: number; colour: string }>
  total: number
  /** The tail the donut folds into one neutral arc; 0 to omit. Carried here
   *  because that arc is otherwise an unlabelled grey wedge. */
  rest: number
  selected: string | null
  /** The tier this row opens, or null if it is a leaf. Per row rather than per
   *  tier, because on the world map the UK drills and its neighbours only
   *  zoom — so the chevron has to be earned row by row. */
  drillOf: (code: string, name: string, funded: boolean) => MapView | null
  onPick: (code: string, name: string, to: MapView | null) => void
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
        const to = drillOf(a.code, a.name, a.amount > 0)
        return (
          <li key={a.code}>
            <button
              type="button"
              onClick={() => onPick(a.code, a.name, to)}
              onMouseEnter={() => onHighlight(a.code)}
              onFocus={() => onHighlight(a.code)}
              onBlur={() => onHighlight(null)}
              aria-current={on || undefined}
              title={`${a.name} · ${fmtCompact(a.amount)} · ${a.count} grant${a.count !== 1 ? 's' : ''} · ${pct}%`}
              className="flex w-full items-center gap-2.5 rounded-chip border px-2.5 py-1.5 text-left"
              style={{
                borderColor: on ? C.brand : 'transparent',
                backgroundColor: on ? '#fff' : highlight === a.code ? C.wash : undefined,
                opacity: dim ? 0.6 : 1,
                transition: 'opacity 200ms ease, background-color 150ms ease',
              }}
            >
              <span
                className="size-2.5 shrink-0 rounded-swatch"
                style={{ backgroundColor: a.colour }}
              />
              <span
                className="min-w-0 flex-1 truncate font-display text-body"
                style={{ color: C.ink }}
              >
                {a.name}
              </span>
              <span
                className="shrink-0 font-display text-label tabular-nums"
                style={{ color: C.sub }}
              >
                {fmtCompact(a.amount)} · {a.count}
              </span>
              {to && (
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
          <span className="size-2.5 shrink-0 rounded-swatch" style={{ backgroundColor: C.line }} />
          <span className="min-w-0 flex-1 truncate font-display text-body" style={{ color: C.sub }}>
            Other areas
          </span>
          <span
            className="shrink-0 font-display text-label tabular-nums"
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
      className="flex items-start gap-2 rounded-control px-3 py-2.5"
      style={{ backgroundColor: C.wash }}
    >
      <HugeiconsIcon
        icon={InformationCircleIcon}
        size={16}
        color={C.sub}
        className="mt-px shrink-0"
      />
      <p className="font-display text-label leading-snug" style={{ color: C.sub }}>
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

type RoundProgramme = {
  /** `null` for grants whose round-programme pairing no longer resolves. */
  id: string | null
  name: string
  grants: number
  total: number
  /** Impact in this programme's own unit — `null` when no grant has stated a figure. */
  impact: number | null
  unitLabel: string
  /** True when any figure in the sum is the applicant's proposal rather than a report. */
  hasProposed: boolean
}

/**
 * A round's grants folded into the programmes that funded them. Impact is summed
 * per programme rather than per round: a round's programmes each measure in their
 * OWN unit ("people", "meals", "hours"), so a round-level total would be adding
 * quantities that don't share a scale — inside one programme they do.
 */
function roundProgrammes(grants: InsightsGrant[]): RoundProgramme[] {
  return [...new Set(grants.map((g) => g.programmeId))]
    .map((pid) => {
      const own = grants.filter((g) => g.programmeId === pid)
      const eff = own
        .map(effImpact)
        .filter((e): e is { value: number; source: ImpactSource } => e !== null)
      return {
        id: pid,
        name: own[0]!.programmeName ?? '—',
        grants: own.length,
        total: own.reduce((s, g) => s + g.amountAwarded, 0),
        impact: eff.length > 0 ? eff.reduce((s, e) => s + e.value, 0) : null,
        unitLabel: own[0]!.unitLabel,
        hasProposed: eff.some((e) => e.source === 'proposed'),
      }
    })
    .sort((a, b) => b.total - a.total)
}

/** Round a chart's top gridline up to 1/2/5 × a power of ten, so ticks divide evenly. */
function niceMax(n: number): number {
  const pow = 10 ** Math.floor(Math.log10(n))
  const step = [1, 2, 2.5, 5, 10].find((m) => n <= m * pow) ?? 10
  return step * pow
}

/** How many themes the panel lists before offering the rest behind a toggle. */
const THEMES_SHOWN = 3

/** The programmes a theme's grants came from — all of them, in the order they were
 *  first seen. Clipping is `TruncatedText`'s job, and only at widths that need it. */
function programmeNames(names: string[]): string[] {
  return [...new Set(names)]
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
        colour: PALETTE[i % PALETTE.length]!,
        committed: grants.reduce((s, g) => s + g.amountAwarded, 0),
        grants: grants.length,
        people: grants[0]!.unitKey === 'people' ? sumImpact(grants) : null,
        unitLabel: grants[0]!.unitLabel,
      }
    })
    .sort((a, b) => b.committed - a.committed)
  // One colour per programme for the whole screen — the round panel below draws the
  // same programme in the same colour this panel gives it, so the two read as one set.
  const programmeColour = new Map(byProgramme.map((p) => [p.id, p.colour]))

  // ── Commitment over time (by round, chronological) ──
  // Line and Bars plot the same series — what each round committed. Line leads and is
  // the default: the panel is called "over time", and the shape of the trend is the
  // question a round-by-round series is opened for; bars are the reading you switch to
  // when comparing one round against another. (A cumulative mode was dropped: a running
  // total answers a different question and read as if the round totals themselves were
  // growing.)
  const [chartMode, setChartMode] = useState<'bars' | 'line'>('line')
  const [showAllThemes, setShowAllThemes] = useState(false)
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
        programmes: roundProgrammes(grants),
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
        colour: PALETTE[i % PALETTE.length]!,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        people: sumImpact(grants.filter((g) => g.unitKey === 'people')),
        // Every programme, not "Warm Homes + 1 other". That summary threw the names
        // away at all widths, including the ones where they fitted, and left "+1"
        // meaning nothing in particular. `TruncatedList` clips only when it must and
        // hands the rest over on hover.
        programmes: programmeNames(
          grants.map((g) => g.programmeName).filter((n): n is string => Boolean(n)),
        ),
      }
    })
    .sort((a, b) => b.amount - a.amount)
  const themedTotal = themes.reduce((s, t) => s + t.amount, 0)
  // Themes are sorted by amount, so the first three are the ones carrying the giving;
  // a foundation with a dozen tags otherwise turns this panel into a long scroll beside
  // a short chart, and the tail is mostly 1–2% rows. The rest stay one click away.
  const visibleThemes = showAllThemes ? themes : themes.slice(0, THEMES_SHOWN)

  // ── Geography: the choropleth + its donut ──
  //
  // The map drills World → United Kingdom → one region's districts. Each level
  // keys on a different field, so the values map is rebuilt per view rather than
  // derived once: countries on ISO alpha-3, regions on the persisted region
  // name, districts on the ONS LAD code.

  // Does the portfolio reach outside the UK? This decides where the map opens
  // — and only that. Every tier stays reachable whatever the answer: a funder
  // working only in Britain should *land* on Britain, but "are we only funding
  // Britain?" is a fair question to be able to ask the map out loud.
  //
  // Measured across every grant rather than the filtered slice, so narrowing a
  // filter cannot pull the map out from under someone mid-read.
  //
  // A constant rather than a test, because there is currently nothing to test:
  // an application records a region and a LAD but no country, so no grant can
  // report a delivery outside the UK. It is named and wired up as a real
  // condition anyway so the day `deliveryCountry` (ISO alpha-3, defaulting to
  // GBR) lands, this line becomes
  //   items.some((g) => g.country && g.country !== 'GBR')
  // and nothing else on the screen has to change.
  //
  // Do NOT reach for `unlocatedCount` as a stand-in. A grant with no region is
  // usually an unresolved UK postcode, not an overseas one, and treating those
  // as international would open a wholly British portfolio on a blank world map.
  const hasOverseas = false

  const [mapView, setMapView] = useState<MapView>(() =>
    hasOverseas ? { kind: 'world' } : { kind: 'uk' },
  )
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
      if (mapView.kind === 'world' || mapView.kind === 'country') {
        // Anything we can place is in Britain, because a region is the only
        // location an application records. Rolling those up to GBR is not a
        // guess — a resolved ONS region *is* a statement that the delivery is
        // in the UK — and without it the world tier showed a British funder
        // their own country unpainted, flatly contradicting the UK view one
        // click below. An empty world map read as broken; this one reads as
        // "all of it is here", which is the true answer.
        if (g.region) add(UK_ISO3, g.amountAwarded)
      } else if (mapView.kind === 'uk') add(g.region, g.amountAwarded)
      else if (mapView.kind === 'region') {
        if (g.region === mapView.region) add(g.ladCode, g.amountAwarded)
      }
    }
    return acc
  })()

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
    colour: PALETTE[i % PALETTE.length]!,
  }))
  const restAmount = areaRanked.slice(PALETTE.length).reduce((s, a) => s + a.amount, 0)
  const areaDonut: DonutSlice[] = [
    ...topAreas.map((a) => ({ areaId: a.code, name: a.name, value: a.amount, colour: a.colour })),
    // Never generate an 8th hue — the tail folds into one neutral "Other".
    ...(restAmount > 0 ? [{ name: 'Other areas', value: restAmount, colour: C.line }] : []),
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
        <h1 className="font-display text-heading font-medium">
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
        {/* Every pill is always rendered, which is the rule the whole app now follows
            (`ui/FilterPill`) and which started here: hiding a filter until it had two
            values meant Location vanished on any portfolio where only one delivery area
            had resolved — read as the filter not existing rather than the data being
            thin. Insights' options are plain lists rather than counted facets, because
            the panels below already count everything the slice contains. */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Programme"
            plural="programmes"
            value={programmeId}
            options={programmes.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => setSearch({ programmeId: v })}
          />
          <FilterPill
            label="Theme"
            plural="themes"
            value={tag}
            options={allTags.map((t) => ({ value: t, label: t }))}
            onChange={(v) => setSearch({ tag: v })}
          />
          <FilterPill
            label="Location"
            plural="locations"
            value={region}
            options={[
              ...regions.map((r) => ({ value: r, label: r })),
              ...(hasUnlocated ? [{ value: NO_REGION, label: 'No location recorded' }] : []),
            ]}
            onChange={(v) => setSearch({ region: v })}
          />
        </div>
        <DateRangePicker
          value={{ from, to }}
          onChange={(next) => setSearch({ from: next.from, to: next.to })}
        />
      </div>

      {fil.length === 0 ? (
        <EmptyState>
          <p className="font-display text-body" style={{ color: C.sub }}>
            No awards match these filters.
          </p>
          <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
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
                            className="font-display text-heading font-medium"
                            style={{ color: C.ink }}
                          >
                            {fmtCompact(p.committed)}
                          </span>
                          <span
                            className="font-display text-body font-medium"
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
                          segments={[{ value: 1, colour: p.colour }]}
                        />
                        <div
                          className="font-display text-body font-medium"
                          style={{ color: C.ink }}
                        >
                          <TruncatedText text={p.name} label="Programme name" />
                        </div>
                        <p className="truncate font-display text-label" style={{ color: C.sub }}>
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
                    className="flex items-center gap-0.5 rounded-chip p-0.5"
                    style={{ backgroundColor: C.wash }}
                  >
                    {/* Line first, and the default — see `chartMode`. */}
                    {(['line', 'bars'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setChartMode(m)}
                        className="h-7 rounded-chip px-2 font-display text-body font-medium capitalize"
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
                <p className="py-10 text-center font-display text-body" style={{ color: C.faint }}>
                  No dated rounds in this slice.
                </p>
              ) : (
                <>
                  <p className="-mt-2 mb-4 font-display text-label" style={{ color: C.sub }}>
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
                <p className="py-10 text-center font-display text-body" style={{ color: C.faint }}>
                  No programme tags set — add tags to programmes to see themed giving.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {visibleThemes.map((t) => {
                    const pct = themedTotal > 0 ? Math.round((t.amount / themedTotal) * 100) : 0
                    return (
                      // A white wrapper card holds the tinted headline and the line
                      // beneath it — which names the programmes the theme spans, so a
                      // theme is never just a percentage with no provenance.
                      <div
                        key={t.tag}
                        className="flex flex-col gap-1 rounded-card border bg-white px-1 pb-2 pt-1"
                        style={{ borderColor: C.line }}
                      >
                        <div
                          className="flex items-center gap-4 rounded-control p-3"
                          style={{ backgroundColor: withAlpha(t.colour, 0.1) }}
                        >
                          <div className="min-w-0 flex-1">
                            <div
                              className="font-display text-body font-medium"
                              style={{ color: C.ink }}
                            >
                              <TruncatedText text={t.tag} label="Theme" />
                            </div>
                            <p
                              className="mt-1 truncate font-display text-label"
                              style={{ color: C.sub }}
                            >
                              {t.count} grant{t.count !== 1 ? 's' : ''} · {fmtCompact(t.amount)}
                              {t.people > 0
                                ? ` · ${Math.round(t.people).toLocaleString('en-GB')} people`
                                : ''}
                            </p>
                          </div>
                          <span
                            className="shrink-0 font-display text-heading font-medium leading-none"
                            style={{ color: t.colour }}
                          >
                            {pct}
                            <span className="text-title" style={{ color: C.faint }}>
                              %
                            </span>
                          </span>
                        </div>
                        <div className="px-3">
                          <TruncatedList
                            items={t.programmes}
                            label={`Programmes funding ${t.tag}`}
                            empty="No programme recorded"
                            className="font-display text-label text-grey-500"
                          />
                        </div>
                      </div>
                    )
                  })}
                  {themes.length > THEMES_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAllThemes((v) => !v)}
                      className="self-start px-3 pt-1 font-display text-label font-medium underline underline-offset-2"
                      style={{ color: C.sub }}
                    >
                      {showAllThemes ? 'Show fewer themes' : `Show all ${themes.length} themes`}
                    </button>
                  )}
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
                    // 70%. The UK is a portrait shape fitted to its column, so at full
                    // width this panel ran taller than everything beside it and the map
                    // was the reason. Shrinking the drawing rather than the column keeps
                    // the donut and the list where they are.
                    scale={0.7}
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
                            className="font-display text-heading font-medium"
                            style={{ color: C.ink }}
                          >
                            {fmtCompact(areaTotal)}
                          </div>
                          <div className="font-display text-label" style={{ color: C.faint }}>
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
                    // Rows act exactly as the same area does on the map — same
                    // rule, from the same function, so the two halves of the
                    // panel can never disagree about what a click means.
                    drillOf={(code, name, funded) => drillTarget(mapView, code, name, funded)}
                    onPick={(code, name, to) => {
                      setSelArea(code)
                      if (to) setMapView(to)
                    }}
                  />

                  {imdPct !== null && <ImdNote pct={imdPct} />}

                  {unlocatedCount > 0 && (
                    <p className="font-display text-label" style={{ color: C.faint }}>
                      {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} with no resolvable
                      location.
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {/* Deprivation-decile distribution */}
          <Panel data-export-block>
            <PanelTitle>Funding by deprivation decile</PanelTitle>
            {locatedAmt === 0 ? (
              <p className="py-10 text-center font-display text-body" style={{ color: C.faint }}>
                No resolved delivery locations in this slice.
              </p>
            ) : (
              <>
                <p className="-mt-1 mb-1 font-display text-label" style={{ color: C.sub }}>
                  Decile 1 is the most deprived 10% of areas in its nation
                  {vintages.length ? ` · ${vintages.join(', ')}` : ''}
                </p>
                <DecileChart amounts={decileAmounts} total={locatedAmt} max={decileMax} />
                {unlocatedCount > 0 && (
                  <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
                    {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} without a resolvable
                    location excluded.
                  </p>
                )}
              </>
            )}
          </Panel>

          {/* Impact by round */}
          {timelineRounds.length > 0 && (
            <Panel data-export-block>
              <PanelTitle>Impact by round</PanelTitle>
              <div className="flex flex-col gap-5">
                {timelineRounds
                  .slice()
                  .reverse()
                  .map((r) => (
                    <div key={r.id}>
                      <div className="mb-2.5 flex items-center gap-2.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: C.brand }}
                        />
                        <span
                          className="font-display text-body font-medium"
                          style={{ color: C.ink }}
                        >
                          {r.name}
                        </span>
                        <span className="font-display text-label" style={{ color: C.sub }}>
                          {r.programmes.length} programme{r.programmes.length !== 1 ? 's' : ''} ·{' '}
                          {r.grants.length} grant{r.grants.length !== 1 ? 's' : ''} ·{' '}
                          {fmtCompact(r.total)}
                        </span>
                        <span className="h-px flex-1" style={{ backgroundColor: C.line }} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {r.programmes.map((p) => (
                          <RoundProgrammeCard
                            key={p.id ?? '—'}
                            programme={p}
                            colour={(p.id && programmeColour.get(p.id)) || C.sub}
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

function RoundProgrammeCard({
  programme: p,
  colour,
}: {
  programme: RoundProgramme
  colour: string
}) {
  const impact =
    p.impact === null
      ? 'no impact figures yet'
      : `${Math.round(p.impact).toLocaleString('en-GB')} ${p.unitLabel.toLowerCase()}${p.hasProposed ? ' (incl. proposed)' : ''}`
  const bg = { backgroundColor: `color-mix(in srgb, ${colour} 12%, transparent)` }
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* The swatch carries the colour; the text never does — at the palette's
                fixed lightness these hues sit near 3:1 on white. */}
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colour }}
              aria-hidden
            />
            <p className="truncate font-display text-body font-medium" style={{ color: C.ink }}>
              {p.name}
            </p>
          </div>
          <p className="mt-0.5 font-display text-label" style={{ color: C.sub }}>
            {p.grants} grant{p.grants !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="shrink-0 font-display text-heading font-medium" style={{ color: C.ink }}>
          {fmtCompact(p.total)}
        </span>
      </div>
      <p className="mt-3 truncate font-display text-label" style={{ color: C.sub }} title={impact}>
        {impact}
      </p>
    </>
  )
  // Filtering the whole screen to this programme is the drill a programme card offers
  // — there is no programme detail route, and the filter pill above shows the state.
  return p.id ? (
    <Link
      to="/insights"
      search={(prev) => ({ ...prev, programmeId: p.id! })}
      className="block rounded-card p-4 transition-shadow hover:shadow-xs"
      style={bg}
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-card p-4" style={bg}>
      {body}
    </div>
  )
}
