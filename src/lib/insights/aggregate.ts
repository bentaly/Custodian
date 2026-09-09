// ─── Insights: shared aggregation primitives ─────────────────────────────────
//
// The handful of rules that turn awarded grants into the figures Insights states.
// They live here rather than on the screen because there are now two readers of
// them: the Insights page itself, and the AI portfolio summary that sits at the
// top of it (`src/lib/portfolioAnalysis`).
//
// That second reader is the whole reason this file exists. The summary is a
// paragraph printed directly above the charts, so a figure it quotes and a figure
// the chart beneath it draws must come from the same arithmetic — not from two
// implementations that agree today. A banner reading "95% of funding reaches the
// most deprived areas" over a chart that draws 88% is worse than no banner.
//
// Everything here is pure and works on `InsightsGrant[]`, the one payload the
// screen and the analysis both start from.

import type { InsightsGrant } from '../../server/fns/insights'

/**
 * The share of ONE grant's funding falling in deciles 1..maxDecile, from its LSOA
 * histogram. A grant delivered across a district spans several deciles, so this is
 * a proportion rather than a yes/no — a grant with 3 of its 10 LSOAs in the bottom
 * four deciles counts 0.3 of its amount toward them, not all of it and not none.
 *
 * Deciles are per-nation. Weighting across nations is the caller's problem to state,
 * never to silently average (see `InsightsDeprivation`).
 */
export function decileShare(g: InsightsGrant, maxDecile: number): number {
  if (!g.deprivation) return 0
  const total = g.deprivation.histogram.reduce((s, n) => s + n, 0)
  if (total === 0) return 0
  const inBand = g.deprivation.histogram.slice(0, maxDecile).reduce((s, n) => s + n, 0)
  return inBand / total
}

export type ImpactSource = 'reported' | 'proposed'

/**
 * A grant's impact figure, provenance-tagged: the ACTUAL from the most recent report
 * carrying one, otherwise the applicant's PROPOSED figure as a fallback. Callers decide
 * how to present each source — proposed figures are estimates, never actuals.
 *
 * "Carrying one" rather than "analysed", because a figure is a figure however it was
 * arrived at: the AI extracts most of them, and the onboarding import carries a
 * foundation's historic figures across with deliberately no analysis behind them.
 */
export function effImpact(g: InsightsGrant): { value: number; source: ImpactSource } | null {
  if (g.impactQuantity !== null) return { value: g.impactQuantity, source: 'reported' }
  if (g.proposedImpactQuantity !== null)
    return { value: g.proposedImpactQuantity, source: 'proposed' }
  return null
}

/** One unit's worth of impact: the total, and whether an estimate is inside it. */
export type UnitTotal = { key: string; label: string; value: number; hasProposed: boolean }

/**
 * Impact totalled WITHIN each unit the given grants measure in, never across them —
 * the one rule this screen has about impact, and the reason there is no single
 * "total impact" number anywhere on it. Ordered by size, so a mixed set leads with
 * the unit carrying most of it.
 *
 * A set spanning "people" and "meals" has no combined total: 1,200 + 31,000 is not
 * 32,200 of anything. It has two totals, and the honest thing is to say both.
 */
export function impactByUnit(grants: InsightsGrant[]): UnitTotal[] {
  const byUnit = new Map<string, UnitTotal>()
  for (const g of grants) {
    const eff = effImpact(g)
    if (!eff) continue
    const t = byUnit.get(g.unitKey) ?? {
      key: g.unitKey,
      label: g.unitLabel,
      value: 0,
      hasProposed: false,
    }
    t.value += eff.value
    // Same honesty as everywhere else impact is quoted: a sum containing an
    // applicant's proposal is not a sum of what was achieved.
    t.hasProposed = t.hasProposed || eff.source === 'proposed'
    byUnit.set(g.unitKey, t)
  }
  return [...byUnit.values()].sort((a, b) => b.value - a.value)
}

/** Funding spread across deciles 1–10, weighting each grant's amount by its histogram. */
export function fundingByDecile(grants: InsightsGrant[]): number[] {
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
