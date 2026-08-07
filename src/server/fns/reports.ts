import { notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { reportSchedule, awards, reports } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { dueStatus, type DueStatus } from '../../lib/schedule'
import { paginate, PAGE_SIZE } from '../../lib/pagination'

export type { DueStatus } from '../../lib/schedule'

// The Reports screen's data. Two distinct things, deliberately kept apart:
//
//   items    — reports that have actually ARRIVED (`reports`, from /api/submit-report).
//              One row per report. This is the screen's primary table: every row is a
//              real document you can open and read.
//   upcoming — dates we are still WAITING on (`report_schedule`, from award set-up).
//              A chase-list, not reading material, so it lives in a side drawer.
//
// These used to be merged into one table, which made a never-submitted milestone look
// like a report. An expectation and a document are different entities; the schema has
// always modelled them as such and the screen now matches.

/** A report that has arrived. */
export type ReceivedStatus = 'received' | 'reviewed'
export type ReportRowStatus = ReceivedStatus | DueStatus

export const listReports = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({
        /** Which received-status tab is open; absent means all of them. */
        status: z.enum(['received', 'reviewed']).optional(),
        page: z.number().int().positive().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    if (!user.clientId) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        upcoming: [],
        totals: emptyTotals(),
      }
    }

    const clientAwards = await getDb().query.awards.findMany({
      where: eq(awards.clientId, user.clientId),
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
        schedule: true,
        reports: true,
      },
    })

    type SubmissionRow = (typeof clientAwards)[number]['reports'][number]

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

    // Reports that have arrived — the screen's primary table.
    const items: Array<{
      key: string
      awardId: string
      applicationId: string
      organisationName: string
      programmeName: string | null
      roundName: string | null
      /** The schedule label this report answered, or "Unscheduled report". */
      label: string
      dueDate: string | null
      submittedAt: string
      status: ReceivedStatus
      submission: SubmissionView
    }> = []

    // Dates still outstanding — the chase-list, shown in the drawer.
    const upcoming: Array<{
      key: string
      awardId: string
      applicationId: string
      organisationName: string
      programmeName: string | null
      label: string
      dueDate: string
      status: DueStatus
    }> = []

    for (const g of clientAwards) {
      const org = g.application.organisationName
      const programmeName = g.application.roundProgramme?.programme?.name ?? null
      const roundName = g.application.roundProgramme?.round?.name ?? null
      const scheduleById = new Map(g.schedule.map((m) => [m.id, m]))

      for (const s of g.reports) {
        const milestone = s.scheduleId ? (scheduleById.get(s.scheduleId) ?? null) : null
        items.push({
          key: s.id,
          awardId: g.id,
          applicationId: g.application.id,
          organisationName: org,
          programmeName,
          roundName,
          label: milestone?.label ?? 'Unscheduled report',
          dueDate: milestone?.dueDate ?? null,
          submittedAt: s.submittedAt.toISOString(),
          status: s.reviewedAt ? 'reviewed' : 'received',
          submission: toSubmissionView(s),
        })
      }

      // A schedule row is outstanding until something ticks it off.
      for (const m of g.schedule) {
        if (m.submittedDate) continue
        upcoming.push({
          key: m.id,
          awardId: g.id,
          applicationId: g.application.id,
          organisationName: org,
          programmeName,
          label: m.label,
          dueDate: m.dueDate,
          status: dueStatus(m.dueDate),
        })
      }
    }

    // Most recently received first — the newest report is the one you came to read.
    items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    // Most overdue first — the chase-list is ordered by urgency.
    upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    const totals = {
      received: items.filter((i) => i.status === 'received').length,
      reviewed: items.filter((i) => i.status === 'reviewed').length,
      overdue: upcoming.filter((i) => i.status === 'overdue').length,
      dueSoon: upcoming.filter((i) => i.status === 'due_soon').length,
      outstanding: upcoming.length,
    }

    // The tab is a server-side filter so that the page is a page of the tab, not a page
    // of everything with the tab applied afterwards. `upcoming` is the drawer's
    // chase-list — short by nature, and read as a whole — so it stays unpaged.
    const filtered = data?.status ? items.filter((i) => i.status === data.status) : items
    return { ...paginate(filtered, data?.page), upcoming, totals }
  })

function emptyTotals() {
  return { received: 0, reviewed: 0, overdue: 0, dueSoon: 0, outstanding: 0 }
}

// Admin sign-off on a received report (and undo). Drives the 'reviewed' status.
export const markReportReviewed = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), reviewed: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const submission = await getDb().query.reports.findFirst({
      where: eq(reports.id, data.id),
      columns: { id: true, clientId: true },
    })
    if (!submission) throw notFoundError()
    assertClientAccess(user, submission.clientId)
    await getDb()
      .update(reports)
      .set(
        data.reviewed
          ? { reviewedAt: new Date(), reviewedBy: user.email ?? user.name ?? null }
          : { reviewedAt: null, reviewedBy: null },
      )
      .where(eq(reports.id, data.id))
  })

// One report for the detail screen. `key` is either a grant_reports milestone id
// (rows from the schedule, with or without a submission) or a report_submissions
// id (unscheduled reports) — the list uses whichever exists, so resolve both.
export const getReport = createServerFn({ method: 'GET' })
  .validator(z.object({ key: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    const milestone = await getDb().query.reportSchedule.findFirst({
      where: eq(reportSchedule.id, data.key),
      with: { reports: true },
    })
    const submissionRow = milestone
      ? (milestone.reports[0] ?? null)
      : ((await getDb().query.reports.findFirst({
          where: eq(reports.id, data.key),
        })) ?? null)

    const awardId = milestone?.awardId ?? submissionRow?.awardId
    if (!awardId) throw notFoundError()

    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, awardId),
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
        // Every report on this award, plus the schedule, so the detail screen can
        // offer the siblings: a report is rarely read in isolation — you want the
        // one before it, and what is still outstanding on the same award.
        schedule: true,
        reports: { columns: { id: true, scheduleId: true, submittedAt: true, reviewedAt: true } },
      },
    })
    if (!award) throw notFoundError()
    assertClientAccess(user, award.clientId)

    const scheduleById = new Map(award.schedule.map((m) => [m.id, m]))

    // Other reports on this award, newest first, excluding the one being viewed.
    const siblings = award.reports
      .filter((r) => r.id !== submissionRow?.id)
      .map((r) => ({
        key: r.id,
        label:
          (r.scheduleId ? scheduleById.get(r.scheduleId)?.label : null) ?? 'Unscheduled report',
        submittedAt: r.submittedAt.toISOString(),
        status: (r.reviewedAt ? 'reviewed' : 'received') as ReceivedStatus,
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

    // Dates still outstanding on this award, most urgent first.
    const outstanding = award.schedule
      .filter((m) => !m.submittedDate && m.id !== milestone?.id)
      .map((m) => ({ key: m.id, label: m.label, dueDate: m.dueDate, status: dueStatus(m.dueDate) }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    const s = submissionRow
    return {
      label: milestone?.label ?? 'Unscheduled report',
      dueDate: milestone?.dueDate ?? null,
      status: (s?.reviewedAt
        ? 'reviewed'
        : s || milestone?.submittedDate
          ? 'received'
          : dueStatus(milestone!.dueDate)) as ReportRowStatus,
      siblings,
      outstanding,
      grant: {
        id: award.id,
        amountAwarded: award.amountAwarded,
        decisionAt: award.decisionAt.toISOString(),
        status: award.status,
      },
      applicationId: award.application.id,
      organisationName: award.application.organisationName,
      programmeName: award.application.roundProgramme?.programme?.name ?? null,
      roundName: award.application.roundProgramme?.round?.name ?? null,
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
