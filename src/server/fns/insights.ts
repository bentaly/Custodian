import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { visibleRoundProgrammeIds } from '../scope'
import { impactUnitLabel } from '../../lib/impactUnits'
import { deliveryRegionLabel, type DeprivationResult } from '../../lib/deprivation/types'

// The Insights screen's data: one row per awarded grant carrying everything the
// portfolio analysis needs — amount, programme + impact unit, round, delivery
// geography, deprivation decile stats, and the latest analysed report's impact
// figures. All aggregation (filters, decile distribution, per-programme impact,
// themes) happens client-side over this one payload, so filter changes are
// instant and every panel is guaranteed to describe the same slice.

// Slimmed decile stats persisted per grant. Deciles are per-nation and NOT
// comparable across nations, so nation + vintage always travel with the numbers.
export type InsightsDeprivation = {
  nation: string
  vintage: string
  min: number
  max: number
  median: number
  // Counts per decile, index 0 → decile 1 … index 9 → decile 10.
  histogram: number[]
}

export type InsightsGrant = {
  awardId: string
  applicationId: string
  organisationName: string
  programmeId: string | null
  programmeName: string | null
  /** The programme's OWN colour, so a programme is one colour everywhere it is drawn. */
  programmeColour: string | null
  unitKey: string
  unitLabel: string
  tags: string[]
  roundId: string | null
  roundName: string | null
  roundOpenedAt: string | null
  decisionAt: string
  status: string
  amountAwarded: number
  // Display region for geography breakdowns: England's 9 regions / "Wales", or
  // the nation for Scotland & NI (deciles/regions aren't England-comparable there).
  region: string | null
  // ONS LAD code (e.g. "E09000019"). The choropleth joins districts on this
  // rather than on `ladName` — ONS names carry inversions and qualifiers
  // ("Bristol, City of", "Kingston upon Hull, City of") that no display string
  // reliably matches.
  ladCode: string | null
  ladName: string | null
  deprivation: InsightsDeprivation | null
  // From the latest analysed report with a quantity — the newest report is taken
  // as the current statement of the grant's impact (milestone reports tend to be
  // cumulative; summing across them would double-count).
  impactQuantity: number | null
  // The applicant's PROPOSED impact from the application (forward-looking, same unit).
  // Insights falls back to this when no analysed report has stated an actual figure.
  proposedImpactQuantity: number | null
  impactQuote: string | null
}

export const getInsights = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  const scope = await visibleRoundProgrammeIds(user)
  // An empty (non-null) scope is a caller who can see nothing; `inArray(x, [])` is a
  // SQL error, so it never reaches the query.
  if (scope !== null && scope.length === 0) return { items: [] as InsightsGrant[] }
  return insightsData(getDb(), scope)
})

/**
 * Insights, as a plain function of (connection, tenant) — the same seam Finance,
 * Awards and Reports have, so everything below the auth check runs without a session.
 *
 * Extracted so tenant isolation can be asserted on the rows this actually returns
 * (`src/server/tenancy.itest.ts`). `scope` is `null` for a superadmin, unrestricted;
 * an empty array is the caller's short-circuit above and must not reach here.
 */
/**
 * What has actually been paid against an award — instalments carrying a paid date.
 * `paidDate` is a DATE column, so it arrives as a string; only its presence matters here.
 */
function paidOn(award: {
  instalments: Array<{ amount: string; paidDate: string | null }>
}): number {
  return award.instalments.reduce((n, i) => (i.paidDate ? n + parseFloat(i.amount) : n), 0)
}

export async function insightsData(
  db: ReturnType<typeof getDb>,
  scope: string[] | null,
): Promise<{ items: InsightsGrant[] }> {
  // Named columns, not the whole row. An application carries five jsonb blobs
  // (`responses`, `custodian_score_detail`, `budget_breakdown`, …) that together are
  // most of its ~2.5KB, and this query loads every awarded application a foundation
  // has. Selecting the dozen fields actually read below is the difference between a
  // few hundred KB and tens of MB once a foundation is making a thousand awards a year.
  // `deprivationContext` is the one jsonb kept — the map is built from it.
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.status, 'awarded'),
      scope ? inArray(applications.roundProgrammeId, scope) : undefined,
    ),
    columns: {
      id: true,
      organisationName: true,
      deliveryRegion: true,
      deliveryNation: true,
      deliveryLadCode: true,
      deliveryLadName: true,
      deprivationContext: true,
      proposedImpactQuantity: true,
      decisionAt: true,
    },
    with: {
      roundProgramme: { with: { programme: true, round: true } },
      award: {
        with: {
          // Two columns only. This is the whole tenant's schedule, and the sole thing
          // read off it is how much has actually been paid.
          instalments: { columns: { amount: true, paidDate: true } },
          // A report row averages ~4KB — mostly the grantee's narrative and the AI's
          // analysis of it. Insights reads four fields of it, so it asks for four.
          reports: {
            columns: {
              id: true,
              submittedAt: true,
              impactQuantity: true,
              impactQuantityQuote: true,
            },
          },
        },
      },
    },
    orderBy: (a, { asc }) => [asc(a.decisionAt)],
  })

  const items: InsightsGrant[] = apps
    // A cancelled grant counts for what it SPENT, not for what it promised — and drops
    // out entirely only if it never paid anything.
    //
    // This is `max(committed, paid)`, the rule the annual budget panel already settled on
    // (`src/lib/annualBudget.ts`): what the money no longer has, whichever way it left. A
    // withdrawn grant is not committed money, so its unpaid half is gone from every figure
    // here — but an instalment that really was paid left the bank, bought whatever it
    // bought, and reached the place it reached. Excluding those grants wholesale, as this
    // did, made real spending invisible: £20,500 went to Great Yarmouth and the map drew
    // nothing there at all.
    //
    // Applied ONCE, on `amountAwarded` below, rather than at the dozen `reduce` call sites
    // downstream — committed, by programme, by theme, by region, the deprivation weighting
    // and the average all read that one field, and a rule enforced in twelve places is a
    // rule that will be missed in the thirteenth.
    .filter((a) => a.award && (a.award.status !== 'cancelled' || paidOn(a.award) > 0))
    .map((a) => {
      const award = a.award!
      const programme = a.roundProgramme?.programme ?? null
      const round = a.roundProgramme?.round ?? null

      // Ordered oldest-first, then read backwards: the impact figure this screen quotes
      // is the most recent one there is. The predicate is the QUANTITY, not the analysis
      // status — a report with a figure has one however it got there, and gating on
      // `analysed` silently dropped the imported ones, which carry a figure the
      // foundation typed and deliberately no AI analysis (there is no narrative to
      // analyse). That made the onboarding import's whole impact column invisible here,
      // which is the one place it was collected for.
      const dated = [...award.reports].sort(
        (x, y) => x.submittedAt.getTime() - y.submittedAt.getTime(),
      )
      const latestWithQuantity = [...dated].reverse().find((s) => s.impactQuantity !== null)

      const dep = a.deprivationContext as DeprivationResult | null
      const deprivation: InsightsDeprivation | null =
        dep && dep.status === 'resolved'
          ? {
              nation: dep.nation,
              vintage: dep.vintage,
              min: dep.min,
              max: dep.max,
              median: dep.median,
              histogram: dep.histogram,
            }
          : null

      return {
        awardId: award.id,
        applicationId: a.id,
        organisationName: a.organisationName,
        programmeId: programme?.id ?? null,
        programmeName: programme?.name ?? null,
        programmeColour: programme?.colour ?? null,
        unitKey: programme?.impactUnit ?? 'people',
        unitLabel: impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel),
        tags: (programme?.tags as string[] | null) ?? [],
        roundId: round?.id ?? null,
        roundName: round?.name ?? null,
        roundOpenedAt: round?.openedAt ? round.openedAt.toISOString() : null,
        decisionAt: award.decisionAt.toISOString(),
        status: award.status,
        // What this grant has actually cost the foundation. For a live grant that is the
        // full award — paid can never exceed it — and for a cancelled one it is only what
        // went out before it was withdrawn.
        amountAwarded:
          award.status === 'cancelled' ? paidOn(award) : parseFloat(award.amountAwarded),
        // Shared with the Awards register (`deliveryRegionLabel`), because the two
        // screens link to each other on this exact string.
        region: deliveryRegionLabel(a),
        ladCode: a.deliveryLadCode,
        ladName: a.deliveryLadName,
        deprivation,
        impactQuantity: latestWithQuantity ? parseFloat(latestWithQuantity.impactQuantity!) : null,
        proposedImpactQuantity:
          a.proposedImpactQuantity != null ? parseFloat(a.proposedImpactQuantity) : null,
        impactQuote: latestWithQuantity?.impactQuantityQuote ?? null,
      }
    })

  return { items }
}
