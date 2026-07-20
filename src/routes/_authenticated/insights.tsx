import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Button, Card, EmptyState } from '../../components/ui'
import { getInsights, type InsightsGrant } from '../../server/fns/insights'
import { exportInsightsPdf } from '../../lib/exportInsightsPdf'

// Insights: portfolio analysis over every awarded grant. Everything on this
// screen is computed — from grant amounts, resolved deprivation deciles, and the
// impact figures the report-analysis pipeline has already extracted and stored.
// No screen-time AI: where a number's coverage is partial (unreported grants,
// unresolved locations) the denominator is stated rather than hidden.

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

function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

// Count-up for the headline stats. Renders the real value on first paint (and
// SSR), then animates towards the target whenever it changes — so filter
// switches roll the numbers. Sits still for users who prefer reduced motion.
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

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
    </Card>
  )
}

// ─── Derivations (all pure, over the filtered grant set) ─────────────────────

/** Share of a grant's location falling in deciles 1..maxDecile, from its histogram. */
function decileShare(g: InsightsGrant, maxDecile: number): number {
  if (!g.deprivation) return 0
  const total = g.deprivation.histogram.reduce((s, n) => s + n, 0)
  if (total === 0) return 0
  const inBand = g.deprivation.histogram.slice(0, maxDecile).reduce((s, n) => s + n, 0)
  return inBand / total
}

/** Funding distributed across deciles 1–10, weighting each grant's amount by its histogram. */
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

  // Impact headline: the selected programme's own unit, or people-programmes only
  // portfolio-wide (units must never be summed across each other).
  const selectedProgramme = programmeId ? fil.find((g) => g.programmeId === programmeId) : undefined
  const impactPool = selectedProgramme ? fil : fil.filter((g) => g.unitKey === 'people')
  const impactReported = impactPool.filter((g) => g.impactQuantity !== null)
  const impactTotal = impactReported.reduce((s, g) => s + (g.impactQuantity ?? 0), 0)
  const impactLabel = selectedProgramme ? selectedProgramme.unitLabel : 'People reached'

  // Deprivation reach: amount-weighted share of located funding in deciles 1–4.
  // Each grant's deciles are within its own nation's index.
  const located = fil.filter((g) => g.deprivation)
  const locatedAmt = located.reduce((s, g) => s + g.amountAwarded, 0)
  const dep14Amt = located.reduce((s, g) => s + g.amountAwarded * decileShare(g, 4), 0)
  const dep14Pct = locatedAmt > 0 ? Math.round((dep14Amt / locatedAmt) * 100) : 0
  const locatedPct = committed > 0 ? Math.round((locatedAmt / committed) * 100) : 0

  const committedUp = useCountUp(committed)
  const impactUp = useCountUp(impactTotal)
  const dep14Up = useCountUp(locatedAmt > 0 ? dep14Pct : 0)
  const avgUp = useCountUp(avgGrant)

  // ── Panel data ──
  const decileAmounts = fundingByDecile(located)
  const vintages = [...new Set(located.map((g) => `${g.deprivation!.vintage}`))].sort()

  const byProgramme = [...new Map(fil.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).keys()]
    .map((pid) => {
      const grants = fil.filter((g) => g.programmeId === pid)
      const reported = grants.filter((g) => g.impactQuantity !== null)
      const impact = reported.reduce((s, g) => s + (g.impactQuantity ?? 0), 0)
      const reportedAmt = reported.reduce((s, g) => s + g.amountAwarded, 0)
      return {
        id: pid,
        name: grants[0]!.programmeName ?? '—',
        unitLabel: grants[0]!.unitLabel,
        committed: grants.reduce((s, g) => s + g.amountAwarded, 0),
        grants: grants.length,
        reported: reported.length,
        impact,
        costPerUnit: impact > 0 ? reportedAmt / impact : null,
      }
    })
    .sort((a, b) => b.committed - a.committed)

  const byRegion = regions
    .filter((r) => !region || r === region)
    .map((r) => {
      const grants = fil.filter((g) => g.region === r)
      return {
        name: r,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        lads: [...new Set(grants.map((g) => g.ladName).filter(Boolean))] as string[],
      }
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.amount - a.amount)
  const unlocatedCount = fil.filter((g) => !g.region).length
  const maxRegionAmt = byRegion[0]?.amount ?? 1

  const tagNames = [...new Set(fil.flatMap((g) => g.tags))].sort()
  const themes = tagNames
    .map((t) => {
      const grants = fil.filter((g) => g.tags.includes(t))
      const withQuote = [...grants].sort((a, b) => b.amountAwarded - a.amountAwarded).find((g) => g.impactQuote)
      return {
        tag: t,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        quote: withQuote ? { text: withQuote.impactQuote!, org: withQuote.organisationName } : null,
      }
    })
    .sort((a, b) => b.amount - a.amount)
  const themedTotal = themes.reduce((s, t) => s + t.amount, 0)

  const alignmentScores = fil.map((g) => g.alignmentScore).filter((s): s is number => s !== null)
  const avgAlignment =
    alignmentScores.length > 0 ? alignmentScores.reduce((s, n) => s + n, 0) / alignmentScores.length : null
  const milestones = fil.reduce(
    (acc, g) => ({
      received: acc.received + g.milestones.received,
      onTime: acc.onTime + g.milestones.onTime,
      overdue: acc.overdue + g.milestones.overdue,
    }),
    { received: 0, onTime: 0, overdue: 0 },
  )
  const reportsAnalysed = fil.reduce((s, g) => s + g.reportsAnalysed, 0)

  // Timeline: rounds in chronological order, grants largest-first within each.
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
  const undatedGrants = fil.filter((g) => !g.roundId)

  function setSearch(patch: Partial<InsightsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  // ── PDF export: a screengrab of the current, filtered state ──
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

  const pillBase = 'rounded-full border px-3 py-1 text-xs transition-colors'
  const pillOn = 'border-emerald-600 bg-emerald-50 font-medium text-emerald-700'
  const pillOff = 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
  const pill = (on: boolean) => `${pillBase} ${on ? pillOn : pillOff}`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="font-display text-[21px] font-semibold text-gray-900"
          >
            Insights
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">Portfolio analysis across every award made</p>
        </div>
        {fil.length > 0 && (
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Export PDF'}
          </Button>
        )}
      </div>

      {/* One filter row scoping every panel below. */}
      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Period</span>
          <button onClick={() => setSearch({ range: undefined })} className={pill(!range || range === 'all')}>
            All time
          </button>
          <button onClick={() => setSearch({ range: '12m' })} className={pill(range === '12m')}>
            Last 12 months
          </button>
          <button onClick={() => setSearch({ range: '24m' })} className={pill(range === '24m')}>
            Last 2 years
          </button>
          {rounds.map((r) => (
            <button key={r.id} onClick={() => setSearch({ range: r.id })} className={pill(range === r.id)}>
              {r.name}
            </button>
          ))}
        </div>
        {programmes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Programme</span>
            <button onClick={() => setSearch({ programmeId: undefined })} className={pill(!programmeId)}>
              All
            </button>
            {programmes.map((p) => (
              <button
                key={p.id}
                onClick={() => setSearch({ programmeId: programmeId === p.id ? undefined : p.id })}
                className={pill(programmeId === p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        {regions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Region</span>
            <button onClick={() => setSearch({ region: undefined })} className={pill(!region)}>
              All
            </button>
            {regions.map((r) => (
              <button
                key={r}
                onClick={() => setSearch({ region: region === r ? undefined : r })}
                className={pill(region === r)}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {fil.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-gray-500">No awards match these filters.</p>
          <p className="mt-1 text-xs text-gray-400">
            Insights build up as awards are made and grant reports are analysed.
          </p>
        </EmptyState>
      ) : (
        <div ref={exportRef} className="space-y-4">
          {/* Headline stats */}
          <div data-export-block className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total committed"
              value={fmtCompact(committedUp)}
              sub={`${fil.length} award${fil.length !== 1 ? 's' : ''}${selectedProgramme ? ` · ${selectedProgramme.programmeName}` : ''}`}
            />
            <StatCard
              label={impactLabel}
              value={impactReported.length > 0 ? Math.round(impactUp).toLocaleString('en-GB') : '—'}
              sub={
                impactPool.length === 0
                  ? 'No people-measured programmes in this slice'
                  : `Reported by ${impactReported.length} of ${impactPool.length} award${impactPool.length !== 1 ? 's' : ''}`
              }
            />
            <StatCard
              label="Deprivation reach"
              value={locatedAmt > 0 ? `${Math.round(dep14Up)}%` : '—'}
              sub={
                locatedAmt > 0
                  ? `Funding reaching the most deprived 40% of areas · location known for ${locatedPct}% of funding`
                  : 'No awards with a resolved location yet'
              }
              accent
            />
            <StatCard label="Average award" value={fmt(avgUp)} sub="Across filtered awards" />
          </div>

          {/* Deprivation distribution + impact by programme */}
          <div data-export-block className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-gray-900">Funding by deprivation decile</h2>
              <p className="mt-0.5 text-xs text-gray-400">
                Awarded funding weighted across the IMD deciles of each award's delivery area · decile 1 is the most
                deprived 10% of areas in its nation{vintages.length > 0 ? ` (${vintages.join(', ')})` : ''}
              </p>
              {locatedAmt === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No resolved delivery locations in this slice yet.
                </p>
              ) : (
                <DecileChart amounts={decileAmounts} total={locatedAmt} />
              )}
              {unlocatedCount > 0 && locatedAmt > 0 && (
                <p className="mt-2 text-[11px] text-gray-400">
                  {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} without a resolvable location excluded.
                </p>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-gray-900">Impact by programme</h2>
              <p className="mt-0.5 text-xs text-gray-400">
                Each programme measures impact in its own unit — figures come from analysed grant reports
              </p>
              {byProgramme.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No programmes in this slice.</p>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {byProgramme.map((p) => (
                    <div key={p.id} className="flex items-baseline gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-gray-700">{p.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {fmtCompact(p.committed)} · {p.grants} award{p.grants !== 1 ? 's' : ''}
                          {p.reported > 0 && p.reported < p.grants ? ` · ${p.reported} reporting` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          {p.impact > 0 ? p.impact.toLocaleString('en-GB') : '—'}
                          <span className="ml-1 text-[11px] font-normal text-gray-400">
                            {p.unitLabel.toLowerCase()}
                          </span>
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {p.costPerUnit !== null
                            ? `${fmt(p.costPerUnit)} per ${p.unitLabel.replace(/s$/i, '').toLowerCase()}`
                            : 'no reports analysed yet'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Geography + themes */}
          <div data-export-block className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-gray-900">Geographic reach</h2>
              <p className="mt-0.5 text-xs text-gray-400">Awarded funding by delivery region</p>
              {byRegion.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No resolved delivery locations yet.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {byRegion.map((r) => (
                    <div key={r.name}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-gray-700">
                          {r.name}
                          {r.lads.length > 0 && (
                            <span className="ml-2 text-[11px] font-normal text-gray-400">
                              {r.lads.slice(0, 3).join(' · ')}
                              {r.lads.length > 3 ? ` +${r.lads.length - 3}` : ''}
                            </span>
                          )}
                        </span>
                        <span className="ml-3 shrink-0 text-gray-700">
                          {fmtCompact(r.amount)}
                          <span className="ml-1.5 text-[11px] text-gray-400">
                            {r.count} award{r.count !== 1 ? 's' : ''}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${Math.max(2, Math.round((r.amount / maxRegionAmt) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {unlocatedCount > 0 && (
                    <p className="text-[11px] text-gray-400">
                      {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} with no resolvable delivery location.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-gray-900">Themes</h2>
              <p className="mt-0.5 text-xs text-gray-400">Giving by programme tag, with what grantees reported</p>
              {themes.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No programme tags set — add tags to programmes to see themed giving here.
                </p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {themes.map((t) => (
                    <div key={t.tag} className="rounded-md border border-gray-100 p-3">
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-medium text-gray-800">{t.tag}</p>
                        <p className="text-sm text-gray-700">
                          {fmtCompact(t.amount)}
                          <span className="ml-1.5 text-[11px] text-gray-400">
                            {themedTotal > 0 ? Math.round((t.amount / themedTotal) * 100) : 0}% of themed giving
                          </span>
                        </p>
                      </div>
                      <p className="text-[11px] text-gray-400">
                        {t.count} award{t.count !== 1 ? 's' : ''}
                      </p>
                      {t.quote && (
                        <blockquote className="mt-2 border-l-2 border-emerald-200 pl-2.5 text-xs italic text-gray-500">
                          “{t.quote.text}”
                          <span className="mt-0.5 block not-italic text-[10px] text-gray-400">— {t.quote.org}</span>
                        </blockquote>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Grantee performance */}
          <div data-export-block className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Promises kept"
              value={avgAlignment !== null ? `${(Math.round(avgAlignment * 10) / 10).toLocaleString('en-GB')}/10` : '—'}
              sub={
                avgAlignment !== null
                  ? `Average alignment with what was applied for · ${alignmentScores.length} analysed report${alignmentScores.length !== 1 ? 's' : ''}`
                  : 'Appears once grant reports are analysed'
              }
            />
            <StatCard
              label="Reporting on time"
              value={milestones.received > 0 ? `${Math.round((milestones.onTime / milestones.received) * 100)}%` : '—'}
              sub={
                milestones.received > 0
                  ? `${milestones.onTime} of ${milestones.received} reports by their due date${milestones.overdue > 0 ? ` · ${milestones.overdue} overdue now` : ''}`
                  : milestones.overdue > 0
                    ? `No reports received yet · ${milestones.overdue} overdue`
                    : 'No reports due yet'
              }
            />
            <StatCard
              label="Reports analysed"
              value={reportsAnalysed > 0 ? String(reportsAnalysed) : '—'}
              sub={`Across ${fil.filter((g) => g.reportsAnalysed > 0).length} of ${fil.length} awards`}
            />
          </div>

          {/* Timeline */}
          <Card data-export-block className="p-5">
            <h2 className="text-sm font-semibold text-gray-900">Impact timeline</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Awards by round — reported outcomes shown where a grant report has been analysed
            </p>
            <div className="mt-4 space-y-5">
              {timelineRounds.map((r) => (
                <div key={r.id}>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                    <span className="text-xs font-semibold text-gray-700">{r.name}</span>
                    <span className="text-[11px] text-gray-400">
                      {r.grants.length} award{r.grants.length !== 1 ? 's' : ''} · {fmtCompact(r.total)}
                    </span>
                    <span className="h-px flex-1 bg-gray-100" />
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 pl-4 sm:grid-cols-2 lg:grid-cols-3">
                    {r.grants.map((g) => (
                      <TimelineGrantCard key={g.awardId} grant={g} />
                    ))}
                  </div>
                </div>
              ))}
              {undatedGrants.length > 0 && (
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                    <span className="text-xs font-semibold text-gray-700">Direct awards</span>
                    <span className="h-px flex-1 bg-gray-100" />
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 pl-4 sm:grid-cols-2 lg:grid-cols-3">
                    {undatedGrants.map((g) => (
                      <TimelineGrantCard key={g.awardId} grant={g} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// Column chart of funding across IMD deciles 1–10. Deciles 1–4 (the "most
// deprived 40%" the headline stat describes) carry the accent; 5–10 recede.
function DecileChart({ amounts, total }: { amounts: number[]; total: number }) {
  const max = Math.max(...amounts, 1)
  return (
    <div>
      <div className="mt-4 flex h-36 items-end gap-1.5" role="img" aria-label="Funding by deprivation decile">
        {amounts.map((amt, i) => {
          const pct = total > 0 ? Math.round((amt / total) * 100) : 0
          const h = Math.round((amt / max) * 100)
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0}>
              <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] text-white group-hover:block group-focus:block">
                Decile {i + 1} · {fmtCompact(amt)} · {pct}%
              </div>
              {amt > 0 && pct >= 5 && (
                <span className="mb-0.5 text-center text-[9px] leading-none text-gray-400">{pct}%</span>
              )}
              <div
                className={`mx-auto w-full max-w-6 rounded-t ${i < 4 ? 'bg-emerald-600' : 'bg-emerald-200'}`}
                style={{ height: `${Math.max(amt > 0 ? 2 : 0, h)}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-gray-100 pt-1">
        {amounts.map((_, i) => (
          <span key={i} className="flex-1 text-center text-[10px] text-gray-400">
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-600" /> Most deprived 40%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-200" /> Deciles 5–10
        </span>
      </div>
      <table className="sr-only">
        <caption>Funding by deprivation decile</caption>
        <tbody>
          {amounts.map((amt, i) => (
            <tr key={i}>
              <th scope="row">Decile {i + 1}</th>
              <td>{fmt(amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TimelineGrantCard({ grant: g }: { grant: InsightsGrant }) {
  const reported = g.reportsAnalysed > 0
  return (
    <Link
      to="/applications/$applicationId"
      params={{ applicationId: g.applicationId }}
      className={`block rounded-md border p-3 transition-colors ${
        reported ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300' : 'border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-medium text-gray-800">{g.organisationName}</p>
        <p className="shrink-0 text-xs text-gray-500">{fmtCompact(g.amountAwarded)}</p>
      </div>
      <p className="mt-0.5 text-[10px] text-gray-400">{g.programmeName ?? '—'}</p>
      {g.outcome ? (
        <p
          className="mt-1.5 text-[11px] leading-snug text-gray-500"
          style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {g.outcome}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] italic text-gray-300">No report yet</p>
      )}
      {g.impactQuantity !== null && (
        <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">
          {g.impactQuantity.toLocaleString('en-GB')} {g.unitLabel.toLowerCase()}
        </p>
      )}
    </Link>
  )
}
