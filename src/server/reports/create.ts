// ─── Shared report-submission create core ────────────────────────────────────
//
// Inserts a report_submissions row for a matched grant, ticks the grant's
// earliest open reporting milestone, and runs the AI analysis — factored out so
// the ingest pipeline (external-ID auto-match) and the admin resolve path
// (manual match) create submissions identically. Mirrors applications/create.ts.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { reportSchedule, awards, reports } from '../../../drizzle/schema'
import { runReportAnalysis } from '../reportAnalysis/run'
import { impactUnitLabel } from '../../lib/impactUnits'
import type { CreateReportSubmissionInput } from '../../lib/validators/report'

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
  matchMethod: 'external_id' | 'manual' | 'import',
) {
  const programme = grant.application?.roundProgramme?.programme ?? null
  const unitLabel = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel)

  const analysis = await runReportAnalysis({
    impactUnitLabel: unitLabel,
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
      organisationName: input.organisationName,
      impactSummary: input.impactSummary,
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
    },
  })

  // Resolve the impact quantity. Precedence: a number the charity actually typed
  // (beneficiaryCount, when the programme counts people) beats an AI extraction;
  // no quantity found stays null — never zero.
  const extracted = analysis.output?.impactQuantity
  let impactQuantity: number | null = null
  let impactQuantitySource: 'reported' | 'ai' | null = null
  let impactQuantityQuote: string | null = null
  if (input.beneficiaryCount != null && (programme?.impactUnit ?? 'people') === 'people') {
    impactQuantity = input.beneficiaryCount
    impactQuantitySource = 'reported'
  } else if (extracted?.found && extracted.value != null) {
    impactQuantity = extracted.value
    impactQuantitySource = 'ai'
    impactQuantityQuote = extracted.quote
  }

  // The earliest open reporting milestone this submission satisfies. dueDate is
  // ISO yyyy-mm-dd text, so ascending lexicographic order is chronological;
  // undated milestones sort last (Postgres puts nulls last ascending).
  const milestone = await getDb().query.reportSchedule.findFirst({
    where: and(eq(reportSchedule.awardId, grant.id), isNull(reportSchedule.submittedDate)),
    orderBy: [asc(reportSchedule.dueDate)],
  })

  const id = crypto.randomUUID()
  await getDb().insert(reports).values({
    id,
    clientId: grant.clientId,
    awardId: grant.id,
    scheduleId: milestone?.id ?? null,
    matchMethod,
    externalApplicationId: input.externalApplicationId,
    organisationName: input.organisationName,
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
    impactSummary: input.impactSummary,
    challenges: input.challenges,
    lessons: input.lessons,
    caseStudies: input.caseStudies,
    testimonials: input.testimonials,
    otherComments: input.otherComments,
    beneficiaryCount: input.beneficiaryCount,
    deliveryArea: input.deliveryArea,
    responses: input.responses,
    analysisStatus: analysis.status === 'analysed' ? 'analysed' : analysis.status === 'error' ? 'error' : 'pending',
    aiSummary: analysis.output?.summary ?? null,
    applicationAlignment: analysis.output?.applicationAlignment ?? null,
    programmeAlignment: analysis.output?.programmeAlignment ?? null,
    aiChallenges: analysis.output?.challengesSummary ?? null,
    aiLessons: analysis.output?.lessonsSummary ?? null,
    impactQuantity: impactQuantity != null ? String(impactQuantity) : null,
    impactQuantitySource,
    impactQuantityQuote,
    impactUnitLabel: unitLabel,
    analysisDetail: analysis.detail,
    analysedAt: analysis.status === 'pending' ? null : new Date(analysis.analysedAt),
  })

  if (milestone) {
    await getDb()
      .update(reportSchedule)
      .set({ submittedDate: new Date().toISOString().slice(0, 10) })
      .where(eq(reportSchedule.id, milestone.id))
  }

  const submission = await getDb().query.reports.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.id, id),
  })
  return { submission, analysis, milestone: milestone ?? null }
}
