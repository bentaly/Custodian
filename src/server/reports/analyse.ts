// ─── A report's AI analysis, as its own step ─────────────────────────────────
//
// The analysis (summary, alignment with the application and the programme, challenges
// and lessons, and the impact figure) is 30-60 seconds of model time. The ingest
// pipeline can afford that inline, but a person attaching a report from the Reports
// screen, or moving it to another grant, cannot be kept waiting for it. So, as with the
// application's assessment (`applications/score.ts`), the report is written at `queued`
// and this fills it in from its own queue message.
//
// Two rules about the impact figure, which Insights totals:
//   - A number the grantee typed (`beneficiary_count`, when the programme counts people)
//     beats the model's extraction.
//   - A number a PERSON corrected (`impact_quantity_source = 'edited'`) beats both, and
//     no re-analysis replaces it.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { reports } from '../../../drizzle/schema'
import { runReportAnalysis } from '../reportAnalysis/run'
import { impactUnitLabel } from '../../lib/impactUnits'
import type { ReportAnalysisInput } from '../../lib/reportAnalysis/prompt'
import type { ReportAnalysisResult } from '../../lib/reportAnalysis/schema'
import { fetchGrantForReport, type GrantForReport } from './create'

/** What the analysis reads of the report itself. */
export type ReportText = {
  organisationName: string
  impactSummary: string | null
  grantPurpose?: string | null
  grantTitle?: string | null
  challenges?: string | null
  lessons?: string | null
  caseStudies?: string | null
  testimonials?: string | null
  otherComments?: string | null
  amountAwarded?: number | null
  beneficiaryCount?: number | null
  deliveryArea?: string | null
  responses: Array<{ label: string; value: string }>
}

export function analysisInputFor(grant: GrantForReport, report: ReportText): ReportAnalysisInput {
  const programme = grant.application?.roundProgramme?.programme ?? null
  return {
    impactUnitLabel: impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel),
    programme: {
      name: programme?.name ?? null,
      description: programme?.description ?? null,
      goal: programme?.goal ?? null,
    },
    missionStatement: programme?.client.profile?.missionStatement ?? null,
    grant: {
      amountAwarded: grant.amountAwarded ? Number(grant.amountAwarded) : null,
      awardedAt: grant.decisionAt ? grant.decisionAt.toISOString().slice(0, 10) : null,
    },
    application: grant.application
      ? {
          organisationName: grant.application.organisationName,
          amountRequested: grant.application.amountRequested
            ? Number(grant.application.amountRequested)
            : null,
          responses: (grant.application.responses ?? []) as Array<{
            label: string
            value: string
          }>,
        }
      : null,
    report: {
      organisationName: report.organisationName,
      impactSummary: report.impactSummary,
      grantPurpose: report.grantPurpose,
      grantTitle: report.grantTitle,
      challenges: report.challenges,
      lessons: report.lessons,
      caseStudies: report.caseStudies,
      testimonials: report.testimonials,
      otherComments: report.otherComments,
      amountAwarded: report.amountAwarded ?? null,
      beneficiaryCount: report.beneficiaryCount ?? null,
      deliveryArea: report.deliveryArea ?? null,
      responses: report.responses,
    },
  }
}

/** The impact figure a report carries, by the precedence in the header. */
export function impactFigure(
  analysis: ReportAnalysisResult | null,
  opts: { beneficiaryCount: number | null | undefined; impactUnit: string | null | undefined },
): {
  impactQuantity: string | null
  impactQuantitySource: string | null
  impactQuantityQuote: string | null
} {
  if (opts.beneficiaryCount != null && (opts.impactUnit ?? 'people') === 'people') {
    return {
      impactQuantity: String(opts.beneficiaryCount),
      impactQuantitySource: 'reported',
      impactQuantityQuote: null,
    }
  }
  const extracted = analysis?.output?.impactQuantity
  if (extracted?.found && extracted.value != null) {
    return {
      impactQuantity: String(extracted.value),
      impactQuantitySource: 'ai',
      impactQuantityQuote: extracted.quote,
    }
  }
  return { impactQuantity: null, impactQuantitySource: null, impactQuantityQuote: null }
}

/** The report columns an analysis result writes. */
export function analysisColumns(analysis: ReportAnalysisResult) {
  return {
    analysisStatus:
      analysis.status === 'analysed'
        ? ('analysed' as const)
        : analysis.status === 'error'
          ? ('error' as const)
          : ('pending' as const),
    aiSummary: analysis.output?.summary ?? null,
    applicationAlignment: analysis.output?.applicationAlignment ?? null,
    programmeAlignment: analysis.output?.programmeAlignment ?? null,
    aiChallenges: analysis.output?.challengesSummary ?? null,
    aiLessons: analysis.output?.lessonsSummary ?? null,
    analysisDetail: analysis.detail,
    analysedAt: analysis.status === 'pending' ? null : new Date(analysis.analysedAt),
  }
}

export type AnalyseReportResult =
  | { ok: false; reason: 'not_found' | 'not_queued' | 'grant_missing' }
  | { ok: true; status: string }

/**
 * Analyse one report and store the result. Acts only on a report still at `queued`
 * unless `force`, so a redelivered queue message does not pay for a second opinion.
 * Never throws for a model failure: that lands as `error`, which Re-run can retry.
 */
export async function analyseReport(
  reportId: string,
  opts: { force?: boolean } = {},
): Promise<AnalyseReportResult> {
  const db = getDb()
  const report = await db.query.reports.findFirst({ where: eq(reports.id, reportId) })
  if (!report) return { ok: false, reason: 'not_found' }
  if (report.analysisStatus !== 'queued' && !opts.force) return { ok: false, reason: 'not_queued' }
  const grant = await fetchGrantForReport(report.awardId)
  if (!grant) return { ok: false, reason: 'grant_missing' }

  const analysis = await runReportAnalysis(
    analysisInputFor(grant, {
      organisationName: report.organisationName,
      impactSummary: report.impactSummary,
      grantPurpose: report.grantPurpose,
      grantTitle: report.grantTitle,
      challenges: report.challenges,
      lessons: report.lessons,
      caseStudies: report.caseStudies,
      testimonials: report.testimonials,
      otherComments: report.otherComments,
      amountAwarded: report.amountAwarded != null ? Number(report.amountAwarded) : null,
      beneficiaryCount: report.beneficiaryCount,
      deliveryArea: report.deliveryArea,
      responses: report.responses ?? [],
    }),
  )
  const programme = grant.application?.roundProgramme?.programme ?? null
  await db
    .update(reports)
    .set({
      ...analysisColumns(analysis),
      // A person's correction stands; otherwise the figure follows the new analysis.
      ...(report.impactQuantitySource === 'edited'
        ? {}
        : impactFigure(analysis, {
            beneficiaryCount: report.beneficiaryCount,
            impactUnit: programme?.impactUnit,
          })),
      impactUnitLabel: impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel),
    })
    .where(eq(reports.id, reportId))
  return { ok: true, status: analysis.status }
}
