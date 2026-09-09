// ─── Portfolio brief: what the model is allowed to know ──────────────────────
//
// The Insights AI summary is not given grants. It is given this: a compact set of
// figures already computed from them, plus the foundation's own giving strategy.
//
// Three reasons it is shaped this way, and each one is load-bearing:
//
//  1. **Every number the paragraph may print is in here, pre-formatted.** The model
//     does no arithmetic — not a percentage, not a share, not an average. A figure it
//     cannot find is a point it does not get to make. That is what makes the output
//     checkable (`verify.ts`) rather than merely plausible, on a screen that exports
//     to PDF and gets read by trustees.
//
//  2. **It is bounded by CATEGORIES, not by grants.** Programmes, rounds, regions,
//     themes and units — a foundation with 900 grants produces a brief barely larger
//     than one with nine. That is what keeps a call at ~2p forever, and it is the
//     whole argument against throwing raw grants at it.
//
//  3. **It carries the tail the screen has to clip.** Insights truncates themes
//     (`TruncatedList`) and shows the leading areas; the model has no pixels to run
//     out of, so it gets all of them. "Eleven of your fourteen themes hold a single
//     grant" is a real finding the page cannot draw at any size.
//
// The figures come from `src/lib/insights/aggregate.ts` — the same functions the
// charts use, so the banner and the panel beneath it cannot disagree.

import type { InsightsGrant } from '../../server/fns/insights'
import { decileShare, effImpact, impactByUnit } from '../insights/aggregate'
import { fmtMoney } from '../format'

/** A money figure as both a number (for us) and the exact string the model must quote. */
export interface Figure {
  value: number
  display: string
}

const money = (n: number): Figure => ({ value: Math.round(n), display: fmtMoney(n) })
const percent = (part: number, whole: number): Figure => {
  const pct = whole > 0 ? Math.round((part / whole) * 100) : 0
  return { value: pct, display: `${pct}%` }
}
const count = (n: number): Figure => ({ value: n, display: n.toLocaleString('en-GB') })

export interface ProgrammeBrief {
  name: string
  goal: string | null
  impactUnit: string
  grants: number
  committed: Figure
  shareOfCommitted: Figure
  meanGrant: Figure
  /** In this programme's OWN unit. Null when no grant under it has stated a figure. */
  impact: { total: Figure; unit: string; includesProposed: boolean } | null
}

export interface RoundBrief {
  name: string
  openedAt: string | null
  grants: number
  committed: Figure
  meanGrant: Figure
}

export interface AreaBrief {
  region: string
  grants: number
  shareOfGrants: Figure
  committed: Figure
  shareOfCommitted: Figure
}

export interface ThemeBrief {
  theme: string
  grants: number
  committed: Figure
}

export interface PortfolioBrief {
  strategy: {
    /** The foundation's giving strategy, verbatim. Null when they have not set one. */
    missionStatement: string | null
    programmes: Array<{ name: string; goal: string | null; impactUnit: string }>
  }
  portfolio: {
    grants: Figure
    committed: Figure
    meanGrant: Figure
    medianGrant: Figure
    smallestGrant: Figure
    largestGrant: Figure
    organisationsFunded: Figure
    organisationsFundedMoreThanOnce: Figure
  }
  byProgramme: ProgrammeBrief[]
  /** Chronological — the series that shows whether grants are getting bigger or smaller. */
  byRound: RoundBrief[]
  byArea: AreaBrief[]
  /** Every theme, including the long tail the screen truncates. */
  byTheme: ThemeBrief[]
  deprivation: {
    /** Grants whose delivery area resolved to a decile spread. */
    grantsMapped: Figure
    moneyMapped: Figure
    shareOfMoneyInDeciles1to4: Figure
    shareOfMoneyInDeciles1to2: Figure
    shareOfMoneyInDeciles7to10: Figure
    /** Per nation, because deciles are national rankings and never comparable across them. */
    nations: Array<{ nation: string; grants: number; committed: Figure }>
  }
  impact: {
    byUnit: Array<{
      unit: string
      total: Figure
      grantsCounted: number
      includesProposed: boolean
    }>
    grantsWithReportedFigure: Figure
    grantsWithProposedFigureOnly: Figure
    grantsWithNoFigure: Figure
  }
  /** What is NOT in the figures above. The model is told to treat these as limits. */
  coverage: string[]
}

const mean = (total: number, n: number) => (n > 0 ? total / n : 0)

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export interface BriefStrategy {
  missionStatement: string | null
  programmes: Array<{ name: string; goal: string | null; impactUnit: string }>
}

/**
 * Fold a foundation's awarded grants into the brief.
 *
 * `grants` is exactly what the Insights screen loads — cancelled grants already
 * reduced to what they actually paid, impact already provenance-tagged. Nothing here
 * re-derives those rules; it groups what they produced.
 */
export function buildPortfolioBrief(
  grants: InsightsGrant[],
  strategy: BriefStrategy,
): PortfolioBrief {
  const committed = grants.reduce((s, g) => s + g.amountAwarded, 0)
  const amounts = grants.map((g) => g.amountAwarded)

  // Repeat grantees. Trimmed and lower-cased only — the same conservative comparison
  // `planDeclineBatch` uses on addresses, and for the same reason: a cleverer match
  // silently merges two organisations that really are different.
  const byOrg = new Map<string, number>()
  for (const g of grants) {
    const key = g.organisationName.trim().toLowerCase()
    byOrg.set(key, (byOrg.get(key) ?? 0) + 1)
  }

  // ── By programme ──
  const programmeIds = [...new Set(grants.map((g) => g.programmeId))]
  const byProgramme: ProgrammeBrief[] = programmeIds
    .map((pid) => {
      const own = grants.filter((g) => g.programmeId === pid)
      const total = own.reduce((s, g) => s + g.amountAwarded, 0)
      const impact = impactByUnit(own)[0] ?? null
      const declared = strategy.programmes.find((p) => p.name === own[0]!.programmeName)
      return {
        name: own[0]!.programmeName ?? 'Unassigned',
        goal: declared?.goal ?? null,
        impactUnit: own[0]!.unitLabel,
        grants: own.length,
        committed: money(total),
        shareOfCommitted: percent(total, committed),
        meanGrant: money(mean(total, own.length)),
        impact: impact
          ? {
              total: count(Math.round(impact.value)),
              unit: impact.label,
              includesProposed: impact.hasProposed,
            }
          : null,
      }
    })
    .sort((a, b) => b.committed.value - a.committed.value)

  // ── By round, chronological ──
  // Ordered by when the round OPENED, not by size: the point of this series is the
  // direction of travel — whether grants are getting bigger or more numerous — and
  // a size-ordered list destroys exactly that.
  const roundIds = [...new Set(grants.map((g) => g.roundId))]
  const byRound: RoundBrief[] = roundIds
    .map((rid) => {
      const own = grants.filter((g) => g.roundId === rid)
      const total = own.reduce((s, g) => s + g.amountAwarded, 0)
      return {
        name: own[0]!.roundName ?? 'Unassigned',
        openedAt: own[0]!.roundOpenedAt?.slice(0, 10) ?? null,
        grants: own.length,
        committed: money(total),
        meanGrant: money(mean(total, own.length)),
      }
    })
    .sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''))

  // ── By area ──
  // Count share and money share side by side. This is the one comparison the screen
  // never draws, and it is where "a tenth of our grants, a thirtieth of our money"
  // lives. Grants with no resolved area get their own row rather than vanishing.
  const regions = [...new Set(grants.map((g) => g.region ?? 'No delivery area recorded'))]
  const byArea: AreaBrief[] = regions
    .map((region) => {
      const own = grants.filter((g) => (g.region ?? 'No delivery area recorded') === region)
      const total = own.reduce((s, g) => s + g.amountAwarded, 0)
      return {
        region,
        grants: own.length,
        shareOfGrants: percent(own.length, grants.length),
        committed: money(total),
        shareOfCommitted: percent(total, committed),
      }
    })
    .sort((a, b) => b.committed.value - a.committed.value)

  // ── By theme ──
  // Every theme, however small. The screen clips this list; the brief must not.
  const themes = [...new Set(grants.flatMap((g) => g.tags))]
  const byTheme: ThemeBrief[] = themes
    .map((theme) => {
      const own = grants.filter((g) => g.tags.includes(theme))
      return {
        theme,
        grants: own.length,
        committed: money(own.reduce((s, g) => s + g.amountAwarded, 0)),
      }
    })
    .sort((a, b) => b.committed.value - a.committed.value)

  // ── Deprivation ──
  const mapped = grants.filter((g) => g.deprivation)
  const mappedMoney = mapped.reduce((s, g) => s + g.amountAwarded, 0)
  const inBand = (max: number) =>
    mapped.reduce((s, g) => s + g.amountAwarded * decileShare(g, max), 0)
  const nations = [...new Set(mapped.map((g) => g.deprivation!.nation))].map((nation) => {
    const own = mapped.filter((g) => g.deprivation!.nation === nation)
    return {
      nation,
      grants: own.length,
      committed: money(own.reduce((s, g) => s + g.amountAwarded, 0)),
    }
  })

  // ── Impact ──
  const withReported = grants.filter((g) => g.impactQuantity !== null)
  const withProposedOnly = grants.filter(
    (g) => g.impactQuantity === null && g.proposedImpactQuantity !== null,
  )
  const withNothing = grants.filter((g) => effImpact(g) === null)

  // Only real limits. A coverage list padded with "0 grants are missing X" invites a
  // sentence spent reporting that nothing is wrong, which is the least useful thing
  // the paragraph could say.
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const coverage = [
    'Every figure here counts a cancelled grant only for what it actually paid out, never for what it promised.',
  ]
  if (withNothing.length > 0) {
    coverage.push(
      `${plural(withNothing.length, 'grant has', 'grants have')} stated no impact figure at all, out of ${grants.length}, and ${withNothing.length === 1 ? 'is' : 'are'} absent from the impact totals.`,
    )
  }
  const unmapped = grants.length - mapped.length
  if (unmapped > 0) {
    const unmappedMoney = grants
      .filter((g) => !g.deprivation)
      .reduce((s, g) => s + g.amountAwarded, 0)
    coverage.push(
      `${plural(unmapped, 'grant', 'grants')} worth ${fmtMoney(unmappedMoney)} ${unmapped === 1 ? 'has' : 'have'} no resolved delivery area, so ${unmapped === 1 ? 'it is' : 'they are'} outside every deprivation figure above.`,
    )
  }
  if (withProposedOnly.length > 0) {
    coverage.push(
      `${plural(withProposedOnly.length, 'grant contributes', 'grants contribute')} the applicant's PROPOSED figure because no report has stated an actual one. Any total marked "includesProposed" is part forecast.`,
    )
  }

  return {
    strategy: {
      missionStatement: strategy.missionStatement?.trim() || null,
      programmes: strategy.programmes,
    },
    portfolio: {
      grants: count(grants.length),
      committed: money(committed),
      meanGrant: money(mean(committed, grants.length)),
      medianGrant: money(median(amounts)),
      smallestGrant: money(amounts.length ? Math.min(...amounts) : 0),
      largestGrant: money(amounts.length ? Math.max(...amounts) : 0),
      organisationsFunded: count(byOrg.size),
      organisationsFundedMoreThanOnce: count([...byOrg.values()].filter((n) => n > 1).length),
    },
    byProgramme,
    byRound,
    byArea,
    byTheme,
    deprivation: {
      grantsMapped: count(mapped.length),
      moneyMapped: money(mappedMoney),
      shareOfMoneyInDeciles1to4: percent(inBand(4), mappedMoney),
      shareOfMoneyInDeciles1to2: percent(inBand(2), mappedMoney),
      shareOfMoneyInDeciles7to10: percent(mappedMoney - inBand(6), mappedMoney),
      nations,
    },
    impact: {
      byUnit: impactByUnit(grants).map((u) => ({
        unit: u.label,
        total: count(Math.round(u.value)),
        grantsCounted: grants.filter((g) => g.unitKey === u.key && effImpact(g) !== null).length,
        includesProposed: u.hasProposed,
      })),
      grantsWithReportedFigure: count(withReported.length),
      grantsWithProposedFigureOnly: count(withProposedOnly.length),
      grantsWithNoFigure: count(withNothing.length),
    },
    coverage,
  }
}
