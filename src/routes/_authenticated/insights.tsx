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
import { EmptyState } from '../../components/ui'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { getInsights, type InsightsGrant } from '../../server/fns/insights'
import { exportInsightsPdf } from '../../lib/exportInsightsPdf'

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
function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}
function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

// Count-up for the headline stats (SSR-safe; sits still under reduced motion).
function useCountUp(target: number, duration = 450): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

function Panel({ children, className = '', innerRef, ...rest }: { children: React.ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div ref={innerRef} className={`rounded-[16px] border bg-white p-4 ${className}`} style={{ borderColor: C.line }} {...rest}>
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

function MiniKpi({
  tint,
  icon,
  label,
  value,
  sub,
}: {
  tint: { bg: string; accent: string }
  icon: typeof Coins01Icon
  label: string
  value: React.ReactNode
  sub: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-[20px] border bg-white p-1" style={{ borderColor: C.line }}>
      <div className="relative overflow-hidden rounded-2xl p-4" style={{ backgroundColor: tint.bg }}>
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-0 aspect-square w-1/2 -translate-y-[17%]"
          style={{
            backgroundImage: `radial-gradient(50% 50% at 50% 50%, ${withAlpha(tint.accent, 0.5)} 0%, ${withAlpha(tint.accent, 0)} 100%)`,
            WebkitMaskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            maskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            WebkitMaskSize: '7px 7px',
            maskSize: '7px 7px',
          }}
        />
        <div className="relative z-10">
          <div className="text-[30px] font-semibold leading-none" style={{ color: C.ink }}>
            {value}
          </div>
          <div className="mt-1.5 text-xs font-medium" style={{ color: C.sub }}>
            {sub}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={icon} className="h-4 w-4" strokeWidth={1.6} style={{ color: C.sub }} />
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>
          {label}
        </span>
      </div>
    </div>
  )
}

// Native <select> styled as a Figma filter pill.
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
      <div className="flex h-9 items-center gap-1 rounded-lg border bg-white pl-3 pr-2" style={{ borderColor: C.line }}>
        <span className="whitespace-nowrap font-display text-[14px] font-medium" style={{ color: C.ink }}>
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

function InsightsPage() {
  const navigate = useNavigate({ from: '/insights' })
  const { range, programmeId, region } = Route.useSearch()
  const { items } = Route.useLoaderData()

  // ── Filter options, derived from the data itself ──
  const rounds = [...new Map(items.filter((g) => g.roundId).map((g) => [g.roundId!, g])).values()]
    .map((g) => ({ id: g.roundId!, name: g.roundName ?? '—', openedAt: g.roundOpenedAt }))
    .sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''))
  const programmes = [...new Map(items.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).values()]
    .map((g) => ({ id: g.programmeId!, name: g.programmeName ?? '—' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const regions = [...new Set(items.map((g) => g.region).filter((r): r is string => Boolean(r)))].sort()

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
  const impactReported = impactPool.filter((g) => g.impactQuantity !== null)
  const impactTotal = impactReported.reduce((s, g) => s + (g.impactQuantity ?? 0), 0)
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
  const byProgramme = [...new Map(fil.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).keys()]
    .map((pid, i) => {
      const grants = fil.filter((g) => g.programmeId === pid)
      const reported = grants.filter((g) => g.impactQuantity !== null)
      return {
        id: pid,
        name: grants[0]!.programmeName ?? '—',
        color: PALETTE[i % PALETTE.length]!,
        committed: grants.reduce((s, g) => s + g.amountAwarded, 0),
        grants: grants.length,
        people: grants[0]!.unitKey === 'people' ? reported.reduce((s, g) => s + (g.impactQuantity ?? 0), 0) : null,
        unitLabel: grants[0]!.unitLabel,
      }
    })
    .sort((a, b) => b.committed - a.committed)

  // ── Commitment over time (by round, chronological) ──
  const [chartMode, setChartMode] = useState<'bars' | 'cumulative'>('bars')
  const timelineRounds = [...new Map(fil.filter((g) => g.roundId).map((g) => [g.roundId!, g])).keys()]
    .map((rid) => {
      const grants = fil.filter((g) => g.roundId === rid).sort((a, b) => b.amountAwarded - a.amountAwarded)
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
  const chartMax = Math.max(1, ...commitSeries.map((p) => (chartMode === 'cumulative' ? p.cumulative : p.bars)))

  // ── Themes ──
  const tagNames = [...new Set(fil.flatMap((g) => g.tags))].sort()
  const themes = tagNames
    .map((t, i) => {
      const grants = fil.filter((g) => g.tags.includes(t))
      const reported = grants.filter((g) => g.impactQuantity !== null && g.unitKey === 'people')
      const withQuote = [...grants].sort((a, b) => b.amountAwarded - a.amountAwarded).find((g) => g.impactQuote)
      return {
        tag: t,
        color: PALETTE[i % PALETTE.length]!,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        people: reported.reduce((s, g) => s + (g.impactQuantity ?? 0), 0),
        quote: withQuote?.impactQuote ?? null,
      }
    })
    .sort((a, b) => b.amount - a.amount)
  const themedTotal = themes.reduce((s, t) => s + t.amount, 0)

  // ── Region + selected-region breakdown ──
  const byRegion = regions
    .map((r) => {
      const grants = fil.filter((g) => g.region === r)
      return { name: r, amount: grants.reduce((s, g) => s + g.amountAwarded, 0), count: grants.length }
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.amount - a.amount)
  const unlocatedCount = fil.filter((g) => !g.region).length

  const [selRegion, setSelRegion] = useState<string | null>(null)
  const activeRegion = selRegion && byRegion.some((r) => r.name === selRegion) ? selRegion : (byRegion[0]?.name ?? null)
  const regionGrants = fil.filter((g) => g.region === activeRegion)
  const regionTotal = regionGrants.reduce((s, g) => s + g.amountAwarded, 0)
  const byLad = [...new Map(regionGrants.map((g) => [g.ladName ?? '—', 0])).keys()]
    .map((lad, i) => ({
      name: lad,
      color: PALETTE[i % PALETTE.length]!,
      amount: regionGrants.filter((g) => (g.ladName ?? '—') === lad).reduce((s, g) => s + g.amountAwarded, 0),
    }))
    .sort((a, b) => b.amount - a.amount)
  const ladDonut: DonutSlice[] = byLad.map((l) => ({ name: l.name, value: l.amount, color: l.color }))

  const earliest = timelineRounds[0]?.name ?? null

  function setSearch(patch: Partial<InsightsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  // ── PDF export ──
  const exportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const periodLabel =
    !range || range === 'all' ? 'All time' : range === '12m' ? 'Last 12 months' : range === '24m' ? 'Last 2 years' : (rounds.find((r) => r.id === range)?.name ?? 'Selected round')
  const programmeLabel = programmeId ? (programmes.find((p) => p.id === programmeId)?.name ?? 'Selected programme') : 'All programmes'
  const regionLabel = region ?? 'All regions'
  async function handleExport() {
    if (!exportRef.current) return
    setExporting(true)
    try {
      await exportInsightsPdf(exportRef.current, {
        title: 'Insights',
        filters: `${periodLabel} · ${programmeLabel} · ${regionLabel}`,
        summary: `${fil.length} award${fil.length !== 1 ? 's' : ''} · ${fmtCompact(committed)} committed`,
        generatedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
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
            <FilterSelect label="Programme" value={programmeId} options={programmes.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => setSearch({ programmeId: v })} />
          )}
          {regions.length > 1 && (
            <FilterSelect label="Region" value={region} options={regions.map((r) => ({ value: r, label: r }))} onChange={(v) => setSearch({ region: v })} />
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
            <MiniKpi tint={KPI.committed} icon={Coins01Icon} label="Total committed" value={fmtCompact(committedUp)} sub={`across ${fil.length} grant${fil.length !== 1 ? 's' : ''}`} />
            <MiniKpi
              tint={KPI.people}
              icon={UserGroupIcon}
              label={impactLabel}
              value={impactReported.length > 0 ? Math.round(impactUp).toLocaleString('en-GB') : '—'}
              sub={impactPool.length === 0 ? 'no people-measured programmes here' : `reported by ${impactReported.length} of ${impactPool.length}`}
            />
            <MiniKpi
              tint={KPI.reach}
              icon={Location01Icon}
              label="Deprivation reach"
              value={locatedAmt > 0 ? `${Math.round(dep14Up)}%` : '—'}
              sub={locatedAmt > 0 ? 'reached IMD decile 1–4' : 'no resolved locations yet'}
            />
            <MiniKpi tint={KPI.avg} icon={ChartAverageIcon} label="Average grant" value={fmtCompact(avgUp)} sub={amounts.length ? `${fmtCompact(minGrant)}–${fmtCompact(maxGrant)} range` : 'across filtered awards'} />
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
                        <span className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
                          {fmtCompact(p.committed)}
                        </span>
                        <span className="font-display text-[13px] font-medium" style={{ color: C.faint }}>
                          {pct}%
                        </span>
                      </div>
                      <BarMeter bars={26} height={22} barWidth={3} className="my-2" progress={pct / 100} color={p.color} />
                      <p className="truncate font-display text-[14px] font-medium" style={{ color: C.ink }} title={p.name}>
                        {p.name}
                      </p>
                      <p className="font-display text-[12px]" style={{ color: C.sub }}>
                        {p.grants} grant{p.grants !== 1 ? 's' : ''}
                        {p.people != null && p.people > 0 ? ` · ${Math.round(p.people).toLocaleString('en-GB')} ${p.unitLabel.toLowerCase()}` : ''}
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
                  <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: C.wash }}>
                    {(['bars', 'cumulative'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setChartMode(m)}
                        className="h-7 rounded-md px-2.5 font-display text-[13px] font-medium capitalize"
                        style={chartMode === m ? { backgroundColor: '#fff', border: `1px solid ${C.line}`, color: C.ink } : { color: C.sub }}
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
                <p className="py-10 text-center font-display text-[14px]" style={{ color: C.faint }}>
                  No dated rounds in this slice.
                </p>
              ) : (
                <div className="mt-2 flex h-44 items-end gap-3">
                  {commitSeries.map((p) => {
                    const v = chartMode === 'cumulative' ? p.cumulative : p.bars
                    const h = Math.round((v / chartMax) * 100)
                    return (
                      <div key={p.label} className="group flex h-full flex-1 flex-col justify-end" title={`${p.label} · ${fmt(v)}`}>
                        <span className="mb-1 text-center font-display text-[11px]" style={{ color: C.faint }}>
                          {fmtCompact(v)}
                        </span>
                        <div className="mx-auto w-full max-w-[44px] rounded-t-md" style={{ height: `${Math.max(2, h)}%`, backgroundColor: '#8B7FF0' }} />
                        <span className="mt-1.5 truncate text-center font-display text-[11px]" style={{ color: C.sub }} title={p.label}>
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
                <p className="py-10 text-center font-display text-[14px]" style={{ color: C.faint }}>
                  No programme tags set — add tags to programmes to see themed giving.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {themes.map((t) => {
                    const pct = themedTotal > 0 ? Math.round((t.amount / themedTotal) * 100) : 0
                    return (
                      <div key={t.tag} className="rounded-xl p-3" style={{ backgroundColor: withAlpha(t.color, 0.1) }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
                              {t.tag}
                            </p>
                            <p className="font-display text-[12px]" style={{ color: C.sub }}>
                              {t.count} grant{t.count !== 1 ? 's' : ''} · {fmtCompact(t.amount)}
                              {t.people > 0 ? ` · ${Math.round(t.people).toLocaleString('en-GB')} people` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 font-display text-[22px] font-medium" style={{ color: t.color }}>
                            {pct}
                            <span className="text-[13px]">%</span>
                          </span>
                        </div>
                        {t.quote && (
                          <p className="mt-1.5 font-display text-[12px] italic" style={{ color: C.sub }}>
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

          {/* Giving by region */}
          {byRegion.length > 0 && (
            <Panel data-export-block>
              <PanelTitle>Giving by region</PanelTitle>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Region list */}
                <div className="flex flex-col gap-1.5">
                  {byRegion.map((r) => {
                    const on = r.name === activeRegion
                    return (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => setSelRegion(r.name)}
                        className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left"
                        style={{ borderColor: on ? C.brand : C.line, backgroundColor: on ? 'rgba(31,122,92,0.05)' : '#fff' }}
                      >
                        <span className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
                          {r.name}
                        </span>
                        <span className="font-display text-[13px]" style={{ color: C.sub }}>
                          {fmtCompact(r.amount)} · {r.count}
                        </span>
                      </button>
                    )
                  })}
                  {unlocatedCount > 0 && (
                    <p className="mt-1 font-display text-[12px]" style={{ color: C.faint }}>
                      {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} with no resolvable location.
                    </p>
                  )}
                </div>

                {/* Selected region donut + LAD breakdown */}
                <div>
                  <p className="mb-2 font-display text-[14px] font-medium" style={{ color: C.ink }}>
                    {activeRegion}
                  </p>
                  <div className="flex items-center gap-5">
                    <Donut
                      data={ladDonut}
                      size={132}
                      thickness={16}
                      center={
                        <div className="text-center">
                          <div className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
                            {fmtCompact(regionTotal)}
                          </div>
                          <div className="font-display text-[12px]" style={{ color: C.faint }}>
                            committed
                          </div>
                        </div>
                      }
                    />
                    <div className="flex-1">
                      {byLad.map((l) => {
                        const pct = regionTotal > 0 ? Math.round((l.amount / regionTotal) * 100) : 0
                        return (
                          <div key={l.name} className="mb-2 last:mb-0">
                            <div className="flex items-baseline justify-between">
                              <span className="font-display text-[13px]" style={{ color: C.ink }}>
                                {l.name}
                              </span>
                              <span className="font-display text-[12px]" style={{ color: C.sub }}>
                                {fmtCompact(l.amount)} · {pct}%
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: C.wash }}>
                              <div className="h-full rounded-full bar-grow" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: l.color }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          )}

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
                        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: C.brand }} />
                        <span className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
                          {r.name}
                        </span>
                        <span className="font-display text-[12px]" style={{ color: C.sub }}>
                          {r.grants.length} grant{r.grants.length !== 1 ? 's' : ''} · {fmtCompact(r.total)}
                        </span>
                        <span className="h-px flex-1" style={{ backgroundColor: C.line }} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {r.grants.map((g, gi) => (
                          <RoundGrantCard key={g.awardId} grant={g} tint={CARD_TINTS[(ri + gi) % CARD_TINTS.length]!} />
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

function RoundGrantCard({ grant: g, tint }: { grant: InsightsGrant; tint: { bg: string; ink: string } }) {
  const people = g.impactQuantity !== null && g.unitKey === 'people' ? g.impactQuantity : null
  const detail = [g.programmeName, g.ladName ?? g.region].filter(Boolean).join(' · ')
  return (
    <Link
      to="/applications/$applicationId"
      params={{ applicationId: g.applicationId }}
      className="block rounded-2xl p-4 transition-shadow hover:shadow-sm"
      style={{ backgroundColor: tint.bg }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] font-medium" style={{ color: C.ink }}>
            {g.organisationName}
          </p>
          <p className="font-display text-[12px]" style={{ color: C.sub }}>
            {people != null ? `${Math.round(people).toLocaleString('en-GB')} ${g.unitLabel.toLowerCase()}` : 'no report yet'}
          </p>
        </div>
        <span className="shrink-0 font-display text-[18px] font-medium" style={{ color: tint.ink }}>
          {fmtCompact(g.amountAwarded)}
        </span>
      </div>
      {detail && (
        <p className="mt-3 truncate font-display text-[12px]" style={{ color: C.sub }} title={detail}>
          {detail}
        </p>
      )}
    </Link>
  )
}
