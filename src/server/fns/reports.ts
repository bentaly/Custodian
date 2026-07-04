import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { grantReports, grants, reportSubmissions } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'

// The Reports screen's data: every reporting milestone across the client's
// grants (the schedule side, from generateAward) merged with the submissions
// that satisfied them (the content side, from /api/submit-report). One row per
// milestone, plus rows for submissions that arrived when a grant had no open
// milestone left ("unscheduled" — still real reports).

export type ReportRowStatus = 'received' | 'reviewed' | 'overdue' | 'due_soon' | 'upcoming'

const DUE_SOON_DAYS = 30

function statusFor(dueDate: string | null, submitted: boolean): ReportRowStatus {
  if (submitted) return 'received'
  if (!dueDate) return 'upcoming'
  const due = new Date(dueDate)
  const now = new Date()
  if (due < now) return 'overdue'
  if (due.getTime() - now.getTime() <= DUE_SOON_DAYS * 24 * 60 * 60 * 1000) return 'due_soon'
  return 'upcoming'
}

export const listReports = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return { items: [], totals: emptyTotals() }

  const clientGrants = await getDb().query.grants.findMany({
    where: eq(grants.clientId, user.clientId),
    with: {
      application: {
        columns: { id: true, organisationName: true, deliveryArea: true },
        with: {
          roundProgramme: {
            columns: { id: true },
            with: {
              programme: { columns: { name: true, impactUnit: true, impactUnitLabel: true } },
              round: { columns: { name: true } },
            },
          },
        },
      },
      reports: true,
      reportSubmissions: true,
    },
  })

  type SubmissionRow = (typeof clientGrants)[number]['reportSubmissions'][number]

  // Shape the submission into an explicitly serializable payload (raw rows carry
  // loosely-typed jsonb that the server-fn serializer rejects).
  function toSubmissionView(s: SubmissionRow) {
    return {
      id: s.id,
      submittedAt: s.submittedAt.toISOString(),
      impactSummary: s.impactSummary,
      challenges: s.challenges,
      lessons: s.lessons,
      analysisStatus: s.analysisStatus,
      aiSummary: s.aiSummary,
      aiChallenges: s.aiChallenges,
      aiLessons: s.aiLessons,
      applicationAlignment: s.applicationAlignment,
      programmeAlignment: s.programmeAlignment,
      impactQuantity: s.impactQuantity,
      impactQuantitySource: s.impactQuantitySource,
      impactQuantityQuote: s.impactQuantityQuote,
      impactUnitLabel: s.impactUnitLabel,
      reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
      reviewedBy: s.reviewedBy,
      flags: ((s.analysisDetail as { flags?: string[] } | null)?.flags ?? []) as string[],
    }
  }
  type SubmissionView = ReturnType<typeof toSubmissionView>

  const items: Array<{
    key: string
    grantId: string
    applicationId: string | null
    organisationName: string
    programmeName: string | null
    roundName: string | null
    label: string
    dueDate: string | null
    status: ReportRowStatus
    submission: SubmissionView | null
  }> = []

  for (const g of clientGrants) {
    const org = g.application?.organisationName ?? '(direct grant)'
    const programmeName = g.application?.roundProgramme?.programme?.name ?? null
    const roundName = g.application?.roundProgramme?.round?.name ?? null
    const byMilestone = new Map(
      g.reportSubmissions.filter((s) => s.grantReportId).map((s) => [s.grantReportId!, s]),
    )

    for (const m of g.reports) {
      const submission = byMilestone.get(m.id) ?? null
      items.push({
        key: m.id,
        grantId: g.id,
        applicationId: g.application?.id ?? null,
        organisationName: org,
        programmeName,
        roundName,
        label: m.label,
        dueDate: m.dueDate,
        status: submission?.reviewedAt
          ? 'reviewed'
          : statusFor(m.dueDate, Boolean(m.submittedDate || submission)),
        submission: submission ? toSubmissionView(submission) : null,
      })
    }
    // Reports that arrived with no open milestone to satisfy.
    for (const s of g.reportSubmissions.filter((s) => !s.grantReportId)) {
      items.push({
        key: s.id,
        grantId: g.id,
        applicationId: g.application?.id ?? null,
        organisationName: org,
        programmeName,
        roundName,
        label: 'Unscheduled report',
        dueDate: null,
        status: s.reviewedAt ? 'reviewed' : 'received',
        submission: toSubmissionView(s),
      })
    }
  }

  // Overdue first (most urgent), then due soon by date, then upcoming, received last.
  const order: Record<ReportRowStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, received: 3, reviewed: 4 }
  items.sort((a, b) => order[a.status] - order[b.status] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))

  const totals = {
    active: items.filter((i) => i.status !== 'received' && i.status !== 'reviewed').length,
    overdue: items.filter((i) => i.status === 'overdue').length,
    dueSoon: items.filter((i) => i.status === 'due_soon').length,
    received: items.filter((i) => i.status === 'received').length,
    reviewed: items.filter((i) => i.status === 'reviewed').length,
  }

  return { items, totals }
})

function emptyTotals() {
  return { active: 0, overdue: 0, dueSoon: 0, received: 0, reviewed: 0 }
}

// Admin sign-off on a received report (and undo). Drives the 'reviewed' status.
export const markReportReviewed = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid(), reviewed: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const submission = await getDb().query.reportSubmissions.findFirst({
      where: eq(reportSubmissions.id, data.id),
      columns: { id: true, clientId: true },
    })
    if (!submission) throw new Error('Not found')
    assertClientAccess(user, submission.clientId)
    await getDb()
      .update(reportSubmissions)
      .set(
        data.reviewed
          ? { reviewedAt: new Date(), reviewedBy: user.email ?? user.name ?? null }
          : { reviewedAt: null, reviewedBy: null },
      )
      .where(eq(reportSubmissions.id, data.id))
  })

// One report for the detail screen. `key` is either a grant_reports milestone id
// (rows from the schedule, with or without a submission) or a report_submissions
// id (unscheduled reports) — the list uses whichever exists, so resolve both.
export const getReport = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ key: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    const milestone = await getDb().query.grantReports.findFirst({
      where: eq(grantReports.id, data.key),
      with: { submissions: true },
    })
    const submissionRow = milestone
      ? (milestone.submissions[0] ?? null)
      : ((await getDb().query.reportSubmissions.findFirst({
          where: eq(reportSubmissions.id, data.key),
        })) ?? null)

    const grantId = milestone?.grantId ?? submissionRow?.grantId
    if (!grantId) throw new Error('Not found')

    const grant = await getDb().query.grants.findFirst({
      where: eq(grants.id, grantId),
      with: {
        application: {
          columns: { id: true, organisationName: true, deliveryArea: true, amountRequested: true },
          with: {
            roundProgramme: {
              columns: { id: true },
              with: {
                programme: { columns: { name: true, impactUnit: true, impactUnitLabel: true } },
                round: { columns: { name: true } },
              },
            },
          },
        },
      },
    })
    if (!grant) throw new Error('Not found')
    assertClientAccess(user, grant.clientId)

    const s = submissionRow
    return {
      label: milestone?.label ?? 'Unscheduled report',
      dueDate: milestone?.dueDate ?? null,
      status: s?.reviewedAt
        ? ('reviewed' as ReportRowStatus)
        : statusFor(milestone?.dueDate ?? null, Boolean(milestone?.submittedDate || s)),
      grant: {
        id: grant.id,
        amountAwarded: grant.amountAwarded,
        decisionAt: grant.decisionAt.toISOString(),
        status: grant.status,
      },
      applicationId: grant.application?.id ?? null,
      organisationName: grant.application?.organisationName ?? '(direct grant)',
      programmeName: grant.application?.roundProgramme?.programme?.name ?? null,
      roundName: grant.application?.roundProgramme?.round?.name ?? null,
      submission: s
        ? {
            id: s.id,
            submittedAt: s.submittedAt.toISOString(),
            matchMethod: s.matchMethod,
            externalApplicationId: s.externalApplicationId,
            charityNumber: s.charityNumber,
            companyNumber: s.companyNumber,
            programmeName: s.programmeName,
            amountAwarded: s.amountAwarded,
            awardDate: s.awardDate,
            awardEndDate: s.awardEndDate,
            contactName: s.contactName,
            contactEmail: s.contactEmail,
            contactPhone: s.contactPhone,
            grantTitle: s.grantTitle,
            grantPurpose: s.grantPurpose,
            impactSummary: s.impactSummary,
            challenges: s.challenges,
            lessons: s.lessons,
            caseStudies: s.caseStudies,
            testimonials: s.testimonials,
            otherComments: s.otherComments,
            beneficiaryCount: s.beneficiaryCount,
            deliveryArea: s.deliveryArea,
            responses: (s.responses ?? []) as Array<{ label: string; value: string }>,
            analysisStatus: s.analysisStatus,
            aiSummary: s.aiSummary,
            aiChallenges: s.aiChallenges,
            aiLessons: s.aiLessons,
            applicationAlignment: s.applicationAlignment,
            programmeAlignment: s.programmeAlignment,
            impactQuantity: s.impactQuantity,
            impactQuantitySource: s.impactQuantitySource,
            impactQuantityQuote: s.impactQuantityQuote,
            impactUnitLabel: s.impactUnitLabel,
            reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
            reviewedBy: s.reviewedBy,
            flags: ((s.analysisDetail as { flags?: string[] } | null)?.flags ?? []) as string[],
          }
        : null,
    }
  })
