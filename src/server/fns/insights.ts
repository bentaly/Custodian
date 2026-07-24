import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { visibleRoundProgrammeIds } from '../scope'
import { impactUnitLabel } from '../../lib/impactUnits'
import type { DeprivationResult } from '../../lib/deprivation/types'

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
  alignmentScore: number | null
  outcome: string | null
  reportsAnalysed: number
  milestones: { total: number; received: number; onTime: number; overdue: number }
}

const NATION_LABELS: Record<string, string> = {
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
}

export const getInsights = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  const scope = await visibleRoundProgrammeIds(user)
  if (scope !== null && scope.length === 0) return { items: [] as InsightsGrant[] }

  const apps = await getDb().query.applications.findMany({
    where: and(
      eq(applications.status, 'awarded'),
      scope ? inArray(applications.roundProgrammeId, scope) : undefined,
    ),
    with: {
      roundProgramme: { with: { programme: true, round: true } },
      award: { with: { schedule: true, reports: true } },
    },
    orderBy: (a, { asc }) => [asc(a.decisionAt)],
  })

  const today = new Date().toISOString().slice(0, 10)

  const items: InsightsGrant[] = apps
    .filter((a) => a.award)
    .map((a) => {
      const award = a.award!
      const programme = a.roundProgramme?.programme ?? null
      const round = a.roundProgramme?.round ?? null

      const analysed = award.reports
        .filter((s) => s.analysisStatus === 'analysed')
        .sort((x, y) => x.submittedAt.getTime() - y.submittedAt.getTime())
      const latestWithQuantity = [...analysed].reverse().find((s) => s.impactQuantity !== null)
      const latestWithAlignment = [...analysed].reverse().find((s) => s.applicationAlignment)
      const latestAnalysed = analysed[analysed.length - 1]

      // A milestone counts as received when it was ticked (submittedDate) or a
      // submission satisfied it; on time means it arrived by its due date.
      const submissionByMilestone = new Map(
        award.reports.filter((s) => s.scheduleId).map((s) => [s.scheduleId!, s]),
      )
      let received = 0
      let onTime = 0
      let overdue = 0
      for (const m of award.schedule) {
        const receivedDate =
          m.submittedDate ??
          submissionByMilestone.get(m.id)?.submittedAt.toISOString().slice(0, 10) ??
          null
        if (receivedDate) {
          received++
          if (!m.dueDate || receivedDate <= m.dueDate) onTime++
        } else if (m.dueDate && m.dueDate < today) {
          overdue++
        }
      }

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
        unitKey: programme?.impactUnit ?? 'people',
        unitLabel: impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel),
        tags: (programme?.tags as string[] | null) ?? [],
        roundId: round?.id ?? null,
        roundName: round?.name ?? null,
        roundOpenedAt: round?.openedAt ? round.openedAt.toISOString() : null,
        decisionAt: award.decisionAt.toISOString(),
        status: award.status,
        amountAwarded: parseFloat(award.amountAwarded),
        region:
          a.deliveryRegion ?? (a.deliveryNation ? (NATION_LABELS[a.deliveryNation] ?? null) : null),
        ladName: a.deliveryLadName,
        deprivation,
        impactQuantity: latestWithQuantity ? parseFloat(latestWithQuantity.impactQuantity!) : null,
        proposedImpactQuantity: a.proposedImpactQuantity != null ? parseFloat(a.proposedImpactQuantity) : null,
        impactQuote: latestWithQuantity?.impactQuantityQuote ?? null,
        alignmentScore: latestWithAlignment?.applicationAlignment?.score ?? null,
        outcome: latestAnalysed?.aiSummary ?? latestAnalysed?.impactSummary ?? null,
        reportsAnalysed: analysed.length,
        milestones: { total: award.schedule.length, received, onTime, overdue },
      }
    })

  return { items }
})
