import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Coins01Icon,
  UserGroupIcon,
  Location01Icon,
  ChartAverageIcon,
  Download01Icon,
  ArrowDown01Icon,
} from '@hugeicons/core-free-icons'
import { EmptyState, MiniKpi } from '../../components/ui'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import {
  Choropleth,
  MapAttribution,
  useAreaNames,
  type MapView,
} from '../../components/charts/Choropleth'
import { demoGeo } from '../../lib/insights/demoGeo'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { getInsights, type InsightsGrant } from '../../server/fns/insights'
import { exportInsightsPdf } from '../../lib/exportInsightsPdf'
import { fmtCompact, fmtMoney } from '../../lib/format'

// Insights: portfolio analysis over every awarded grant. Everything on this
// screen is computed — from grant amounts, resolved deprivation deciles, and the
// impact figures the report-analysis pipeline has already extracted and stored.
// No screen-time AI: where a number's coverage is partial the denominator is stated.

type InsightsSearch = {
  /** 'all' | '12m' | '24m' | a round id. */
  range?: string
  programmeId?: string
  region?: string
}

export const Route = createFileRoute('/_authenticated/insights')({
  validateSearch: (search: Record<string, unknown>): InsightsSearch => ({
    range: typeof search.range === 'string' && search.range ? search.range : undefined,
    programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
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
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

// Native <select> styled as a Figma filter pill.
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
      <div className="mt-2 flex h-40 items-end gap-2">
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
                  className="mb-1 text-center font-display text-[10px]"
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
              <span
                className="mt-1.5 text-center font-display text-[11px]"
                style={{ color: C.sub }}
              >
                {i + 1}
              </span>
            </div>
          )
        })}
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
        className="flex h-9 items-center gap-1 rounded-lg border bg-white pl-3 pr-2"
        style={{ borderColor: C.line }}
      >
        <span
          className="whitespace-nowrap font-display text-[14px] font-medium"
          style={{ color: C.ink }}
        >
          {current ? current.label : label}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.sub} />
      </div>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Derivations (pure, over the filtered grant set) ─────────────────────────────

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
  const { range, programmeId, region } = Route.useSearch()
  const { items } = Route.useLoaderData()

  // ── Filter options, derived from the data itself ──
  const rounds = [...new Map(items.filter((g) => g.roundId).map((g) => [g.roundId!, g])).values()]
    .map((g) => ({ id: g.roundId!, name: g.roundName ?? '—', openedAt: g.roundOpenedAt }))
    .sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''))
  const programmes = [
    ...new Map(items.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).values(),
  ]
    .map((g) => ({ id: g.programmeId!, name: g.programmeName ?? '—' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const regions = [
    ...new Set(items.map((g) => g.region).filter((r): r is string => Boolean(r))),
  ].sort()

  // ── The filtered slice every panel below describes ──
  const fil = items.filter((g) => {
    if (programmeId && g.programmeId !== programmeId) return false
    if (region && g.region !== region) return false
    if (!range || range === 'all') return true
    if (range === '12m' || range === '24m') {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - (range === '12m' ? 12 : 24))
      return new Date(g.decisionAt) >= cutoff
    }
    return g.roundId === range
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
  const [chartMode, setChartMode] = useState<'bars' | 'cumulative'>('bars')
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
  let running = 0
  const commitSeries = timelineRounds.map((r) => {
    running += r.total
    return { label: r.name, bars: r.total, cumulative: running }
  })
  const chartMax = Math.max(
    1,
    ...commitSeries.map((p) => (chartMode === 'cumulative' ? p.cumulative : p.bars)),
  )

  // ── Themes ──
  const tagNames = [...new Set(fil.flatMap((g) => g.tags))].sort()
  const themes = tagNames
    .map((t, i) => {
      const grants = fil.filter((g) => g.tags.includes(t))
      const withQuote = [...grants]
        .sort((a, b) => b.amountAwarded - a.amountAwarded)
        .find((g) => g.impactQuote)
      return {
        tag: t,
        color: PALETTE[i % PALETTE.length]!,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        people: sumImpact(grants.filter((g) => g.unitKey === 'people')),
        quote: withQuote?.impactQuote ?? null,
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
  const unlocatedCount = fil.filter((g) => !g.region).length

  // Roll grants up to whichever key the current view paints.
  const realValues = (() => {
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
      // World: nothing to add yet. Delivery geography is UK-only today — there
      // is no country on a grant — so the world tier has no real data to show
      // rather than a wrong one. See demoGeo.ts.
    }
    return acc
  })()

  // DEMO SWITCH — set to false to drive the map from real awards.
  //
  // While the map is being shown off, the sample portfolio drives it at every
  // level, so all three tiers (including World, which no real grant can fill
  // yet) have something to show. `realValues` above stays live and correct, so
  // flipping this back is the only change needed.
  //
  // The "Sample data" badge is tied to this flag, NOT to whether real data
  // happens to exist. These are invented funding figures on a screen whose job
  // is reporting where a foundation's money actually went — while they are on
  // screen, the screen has to say so.
  const USE_SAMPLE_GEO = true

  // Real grants that carry a country, i.e. whether the World tier has anything
  // to paint. Zero today — no country is persisted on an application yet.
  const realCountryCount = 0

  const isDemo = USE_SAMPLE_GEO
  const mapValues = !USE_SAMPLE_GEO
    ? realValues
    : // A zoomed country is still the country layer — same keys as World, so it
      // keeps the same values and the figures don't shift under the zoom.
      mapView.kind === 'world' || mapView.kind === 'country'
      ? demoGeo.world()
      : mapView.kind === 'uk'
        ? demoGeo.regions()
        : demoGeo.districts(mapView.region)

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
    ...topAreas.map((a) => ({ name: a.name, value: a.amount, color: a.color })),
    // Never generate an 8th hue — the tail folds into one neutral "Other".
    ...(restAmount > 0
      ? [{ name: 'Other areas', value: restAmount, color: C.line }]
      : []),
  ]

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

  const earliest = timelineRounds[0]?.name ?? null

  function setSearch(patch: Partial<InsightsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  // ── PDF export ──
  const exportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const periodLabel =
    !range || range === 'all'
      ? 'All time'
      : range === '12m'
        ? 'Last 12 months'
        : range === '24m'
          ? 'Last 2 years'
          : (rounds.find((r) => r.id === range)?.name ?? 'Selected round')
  const programmeLabel = programmeId
    ? (programmes.find((p) => p.id === programmeId)?.name ?? 'Selected programme')
    : 'All programmes'
  const regionLabel = region ?? 'All regions'
  async function handleExport() {
    if (!exportRef.current) return
    setExporting(true)
    try {
      await exportInsightsPdf(exportRef.current, {
        title: 'Insights',
        filters: `${periodLabel} · ${programmeLabel} · ${regionLabel}`,
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[20px] font-medium">
          <span style={{ color: C.ink }}>The story </span>
          <span style={{ color: C.faint }}>so far</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {earliest && (
            <span className="font-display text-[13px] font-medium" style={{ color: C.brand }}>
              {items.length} grant{items.length !== 1 ? 's' : ''} since {earliest}
            </span>
          )}
          <FilterSelect
            label="Period"
            value={range}
            options={[
              { value: 'all', label: 'All time' },
              { value: '12m', label: 'Last 12 months' },
              { value: '24m', label: 'Last 2 years' },
              ...rounds.map((r) => ({ value: r.id, label: r.name })),
            ]}
            onChange={(v) => setSearch({ range: v })}
          />
          {programmes.length > 1 && (
            <FilterSelect
              label="Programme"
              value={programmeId}
              options={programmes.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => setSearch({ programmeId: v })}
            />
          )}
          {regions.length > 1 && (
            <FilterSelect
              label="Region"
              value={region}
              options={regions.map((r) => ({ value: r, label: r }))}
              onChange={(v) => setSearch({ region: v })}
            />
          )}
          {fil.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="flex h-9 items-center gap-2 rounded-lg border px-3 disabled:opacity-60"
              style={{ backgroundColor: 'rgba(31,122,92,0.1)', borderColor: 'rgba(31,122,92,0.2)' }}
            >
              <span className="font-display text-[14px] font-medium" style={{ color: C.brand }}>
                {exporting ? 'Preparing…' : 'Export PDF'}
              </span>
              <HugeiconsIcon icon={Download01Icon} size={18} color={C.brand} />
            </button>
          )}
        </div>
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
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
                {byProgramme.map((p) => {
                  const pct = committed > 0 ? Math.round((p.committed / committed) * 100) : 0
                  return (
                    <div key={p.id}>
                      <div className="flex items-baseline justify-between">
                        <span
                          className="font-display text-[20px] font-medium"
                          style={{ color: C.ink }}
                        >
                          {fmtCompact(p.committed)}
                        </span>
                        <span
                          className="font-display text-[13px] font-medium"
                          style={{ color: C.faint }}
                        >
                          {pct}%
                        </span>
                      </div>
                      <BarMeter
                        bars={48}
                        height={22}
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
                      <p className="font-display text-[12px]" style={{ color: C.sub }}>
                        {p.grants} grant{p.grants !== 1 ? 's' : ''}
                        {p.people != null && p.people > 0
                          ? ` · ${Math.round(p.people).toLocaleString('en-GB')} ${p.unitLabel.toLowerCase()}`
                          : ''}
                      </p>
                    </div>
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
                    {(['bars', 'cumulative'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setChartMode(m)}
                        className="h-7 rounded-md px-2.5 font-display text-[13px] font-medium capitalize"
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
                <div className="mt-2 flex h-44 items-end gap-3">
                  {commitSeries.map((p) => {
                    const v = chartMode === 'cumulative' ? p.cumulative : p.bars
                    const h = Math.round((v / chartMax) * 100)
                    return (
                      <div
                        key={p.label}
                        className="group flex h-full flex-1 flex-col justify-end"
                        title={`${p.label} · ${fmtMoney(v)}`}
                      >
                        <span
                          className="mb-1 text-center font-display text-[11px]"
                          style={{ color: C.faint }}
                        >
                          {fmtCompact(v)}
                        </span>
                        <div
                          className="mx-auto w-full max-w-[44px] rounded-t-md"
                          style={{ height: `${Math.max(2, h)}%`, backgroundColor: '#8B7FF0' }}
                        />
                        <span
                          className="mt-1.5 truncate text-center font-display text-[11px]"
                          style={{ color: C.sub }}
                          title={p.label}
                        >
                          {p.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
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
                <div className="flex flex-col gap-2.5">
                  {themes.map((t) => {
                    const pct = themedTotal > 0 ? Math.round((t.amount / themedTotal) * 100) : 0
                    return (
                      <div
                        key={t.tag}
                        className="rounded-xl p-3"
                        style={{ backgroundColor: withAlpha(t.color, 0.1) }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p
                              className="font-display text-[14px] font-medium"
                              style={{ color: C.ink }}
                            >
                              {t.tag}
                            </p>
                            <p className="font-display text-[12px]" style={{ color: C.sub }}>
                              {t.count} grant{t.count !== 1 ? 's' : ''} · {fmtCompact(t.amount)}
                              {t.people > 0
                                ? ` · ${Math.round(t.people).toLocaleString('en-GB')} people`
                                : ''}
                            </p>
                          </div>
                          <span
                            className="shrink-0 font-display text-[22px] font-medium"
                            style={{ color: C.faint }}
                          >
                            {pct}
                            <span className="text-[13px]">%</span>
                          </span>
                        </div>
                        {t.quote && (
                          <p
                            className="mt-1.5 font-display text-[12px] italic"
                            style={{ color: C.sub }}
                          >
                            “{t.quote}”
                          </p>
                        )}
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
              <PanelTitle
                right={
                  isDemo ? (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 font-display text-[11px] font-medium"
                      style={{ backgroundColor: KPI.reach.bg, color: '#B26A05' }}
                      title="No award in this slice has a resolved delivery location, so the map is showing a sample portfolio."
                    >
                      Sample data
                    </span>
                  ) : undefined
                }
              >
                Giving by area
              </PanelTitle>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
                <div>
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
                    showWorld={isDemo || realCountryCount > 0}
                  />
                  <MapAttribution />
                </div>

                <div>
                  <div className="flex items-center gap-5">
                    <Donut
                      data={areaDonut}
                      size={132}
                      thickness={16}
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
                    <ul className="min-w-0 flex-1 space-y-1">
                      {topAreas.map((a) => {
                        const pct = areaTotal > 0 ? Math.round((a.amount / areaTotal) * 100) : 0
                        const on = selArea === a.code
                        return (
                          <li key={a.code}>
                            <button
                              type="button"
                              onClick={() => setSelArea(on ? null : a.code)}
                              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-black/[0.03]"
                              style={{ backgroundColor: on ? C.wash : undefined }}
                            >
                              <span
                                className="size-2 shrink-0 rounded-[2px]"
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
                                {fmtCompact(a.amount)} · {pct}%
                              </span>
                            </button>
                          </li>
                        )
                      })}
                      {restAmount > 0 && (
                        <li className="flex items-baseline gap-2 px-1 py-0.5">
                          <span
                            className="size-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: C.line }}
                          />
                          <span
                            className="min-w-0 flex-1 truncate font-display text-[13px]"
                            style={{ color: C.sub }}
                          >
                            Other areas
                          </span>
                          <span
                            className="shrink-0 font-display text-[12px] tabular-nums"
                            style={{ color: C.sub }}
                          >
                            {fmtCompact(restAmount)}
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>

                  {unlocatedCount > 0 && (
                    <p className="mt-3 font-display text-[12px]" style={{ color: C.faint }}>
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
