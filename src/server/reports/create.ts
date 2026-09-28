// ─── Shared report-submission create core ────────────────────────────────────
//
// Inserts a report row for a matched grant, ticks the grant's earliest open reporting
// milestone, and analyses it, factored out so the ingest pipeline (external-ID
// auto-match), the admin resolve path and the Reports screen's "attach to a grant"
// create reports identically. Mirrors applications/create.ts.
//
// The analysis runs INLINE by default (the pipeline, the admin app) or is QUEUED
// (`analysis: 'queued'`) for a person on the Reports screen, who should not wait a
// minute for the model; `./analyse.ts` then fills it in.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { reportSchedule, awards, reports } from '../../../drizzle/schema'
import { recomputeAwardStatus } from '../awards/status'
import { runReportAnalysis } from '../reportAnalysis/run'
import { impactUnitLabel } from '../../lib/impactUnits'
import type { CreateReportSubmissionInput } from '../../lib/validators/report'
import { analysisColumns, analysisInputFor, impactFigure } from './analyse'

/** Fetch a grant with everything the report pipeline needs: the application it
 *  came from (for promise-alignment) and the programme (goal + impact unit). */
export async function fetchGrantForReport(awardId: string) {
  return getDb().query.awards.findFirst({
    where: eq(awards.id, awardId),
    with: {
      application: {
        with: {
          roundProgramme: {
            with: { programme: { with: { client: { with: { profile: true } } } } },
          },
        },
      },
    },
  })
}

export type GrantForReport = NonNullable<Awaited<ReturnType<typeof fetchGrantForReport>>>

export async function createReportSubmissionFromCanonical(
  grant: GrantForReport,
  input: CreateReportSubmissionInput,
  matchMethod: 'external_id' | 'manual' | 'import' | 'charity_number',
  opts: { analysis?: 'inline' | 'queued' } = {},
) {
  const programme = grant.application?.roundProgramme?.programme ?? null
  const unitLabel = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel)
  // A report that did not say who it is from is from the grantee it is attached to.
  const organisationName =
    input.organisationName ?? grant.application?.organisationName ?? 'Unknown organisation'

  const analysis =
    opts.analysis === 'queued'
      ? null
      : await runReportAnalysis(
          analysisInputFor(grant, {
            organisationName,
            impactSummary: input.impactSummary ?? null,
            grantPurpose: input.grantPurpose,
            grantTitle: input.grantTitle,
            challenges: input.challenges,
            lessons: input.lessons,
            caseStudies: input.caseStudies,
            testimonials: input.testimonials,
            otherComments: input.otherComments,
            amountAwarded: input.amountAwarded ?? null,
            beneficiaryCount: input.beneficiaryCount ?? null,
            deliveryArea: input.deliveryArea ?? null,
            responses: input.responses,
          }),
        )

  // The earliest open reporting milestone this submission satisfies. dueDate is
  // ISO yyyy-mm-dd text, so ascending lexicographic order is chronological;
  // undated milestones sort last (Postgres puts nulls last ascending).
  const milestone = await getDb().query.reportSchedule.findFirst({
    where: and(eq(reportSchedule.awardId, grant.id), isNull(reportSchedule.submittedDate)),
    orderBy: [asc(reportSchedule.dueDate)],
  })

  const id = crypto.randomUUID()
  await getDb()
    .insert(reports)
    .values({
      id,
      clientId: grant.clientId,
      awardId: grant.id,
      scheduleId: milestone?.id ?? null,
      matchMethod,
      externalApplicationId: input.externalApplicationId,
      organisationName,
      charityNumber: input.charityNumber,
      companyNumber: input.companyNumber,
      programmeName: input.programmeName,
      amountAwarded: input.amountAwarded != null ? String(input.amountAwarded) : null,
      awardDate: input.awardDate,
      awardEndDate: input.awardEndDate,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      grantTitle: input.grantTitle,
      grantPurpose: input.grantPurpose,
      impactSummary: input.impactSummary ?? null,
      challenges: input.challenges,
      lessons: input.lessons,
      caseStudies: input.caseStudies,
      testimonials: input.testimonials,
      otherComments: input.otherComments,
      beneficiaryCount: input.beneficiaryCount,
      deliveryArea: input.deliveryArea,
      responses: input.responses,
      ...(analysis ? analysisColumns(analysis) : { analysisStatus: 'queued' as const }),
      // The grantee's own count stands now; the model's extraction follows the analysis.
      ...impactFigure(analysis, {
        beneficiaryCount: input.beneficiaryCount,
        impactUnit: programme?.impactUnit,
      }),
      impactUnitLabel: unitLabel,
    })

  if (milestone) {
    await getDb()
      .update(reportSchedule)
      .set({ submittedDate: new Date().toISOString().slice(0, 10) })
      .where(eq(reportSchedule.id, milestone.id))
  }

  // Both directions are live here. A report answering the last open milestone can be
  // what completes the grant; one landing on an already-complete grant reopens it,
  // because it arrives unreviewed and nobody has read it yet.
  await recomputeAwardStatus(grant.id)

  const submission = await getDb().query.reports.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.id, id),
  })
  return { submission, analysis, milestone: milestone ?? null }
}
