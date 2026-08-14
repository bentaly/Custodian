import { notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { reportSchedule, awards, reports } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { dueStatus, type DueStatus } from '../../lib/schedule'
import { facetBy, facetByMany, type FacetOption } from '../../lib/facets'
import { paginate, PAGE_SIZE } from '../../lib/pagination'
import { sortRows } from '../../lib/sortRows'

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
        /**
         * The screen's context filter. Unlike the transient pills on the list screens
         * this narrows EVERYTHING — table, tab counts, KPIs and the chase-list drawer —
         * because "reports for this programme" is a question about all four, and a KPI
         * row that stayed portfolio-wide beside a filtered table would be read as the
         * table's own count.
         */
        programmeId: z.uuid().optional(),
        /** Structural narrowings, scoped exactly as `programmeId` is — see above. */
        roundId: z.uuid().optional(),
        tag: z.string().min(1).max(100).optional(),
        /**
         * Inclusive RECEIVED-date window (`yyyy-mm-dd`). Unlike the three above this
         * narrows the table and the tab counts only, and deliberately not the "reports
         * due" panel: that panel is about reports which have not arrived, and filtering
         * them by the date they arrived on would empty it every time the window was used.
         */
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        /** Column sort over `items`; the chase-list keeps its urgency order. */
        sortBy: z
          .enum(['organisation', 'programme', 'round', 'report', 'received', 'status'])
          .optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
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
        facets: {
          programmes: [] as FacetOption[],
          themes: [] as FacetOption[],
          rounds: [] as FacetOption[],
        },
      }
    }

    const clientAwards = await getDb().query.awards.findMany({
      where: eq(awards.clientId, user.clientId),
      with: {
        application: {
          columns: { id: true, organisationName: true, deliveryArea: true },
          with: {
            roundProgramme: {
              columns: { id: true, programmeId: true },
              with: {
                programme: {
                  columns: { name: true, impactUnit: true, impactUnitLabel: true, tags: true },
                },
                round: { columns: { id: true, name: true } },
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
      programmeId: string | null
      programmeName: string | null
      roundId: string | null
      roundName: string | null
      tags: string[]
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
      programmeId: string | null
      programmeName: string | null
      roundId: string | null
      roundName: string | null
      tags: string[]
      label: string
      dueDate: string
      status: DueStatus
    }> = []

    for (const g of clientAwards) {
      const org = g.application.organisationName
      const programmeId = g.application.roundProgramme?.programmeId ?? null
      const programmeName = g.application.roundProgramme?.programme?.name ?? null
      const roundId = g.application.roundProgramme?.round?.id ?? null
      const roundName = g.application.roundProgramme?.round?.name ?? null
      const tags = ((g.application.roundProgramme?.programme?.tags as string[] | null) ??
        []) as string[]
      const scheduleById = new Map(g.schedule.map((m) => [m.id, m]))

      for (const s of g.reports) {
        const milestone = s.scheduleId ? (scheduleById.get(s.scheduleId) ?? null) : null
        items.push({
          key: s.id,
          awardId: g.id,
          applicationId: g.application.id,
          organisationName: org,
          programmeId,
          programmeName,
          roundId,
          roundName,
          tags,
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
          programmeId,
          programmeName,
          roundId,
          roundName,
          tags,
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

    // Counted over every report in scope, before the programme filter below — a pill
    // whose own options shrank as you used it would let you filter into a corner.
    // Faceted over BOTH lists, not just the arrived ones: a round whose reports are all
    // still outstanding is exactly the round you want to be able to select, and faceting
    // over `items` alone would leave it out of the pill entirely.
    const forFacets = [...items, ...upcoming]
    const facets = {
      programmes: facetBy(forFacets, (i) =>
        i.programmeId
          ? { value: i.programmeId, label: i.programmeName ?? 'Untitled programme' }
          : null,
      ),
      themes: facetByMany(forFacets, (i) => i.tags.map((t) => ({ value: t, label: t }))),
      rounds: facetBy(forFacets, (i) =>
        i.roundId ? { value: i.roundId, label: i.roundName ?? 'Untitled round' } : null,
      ),
    }

    // The structural filters are this screen's context, so they land before the totals:
    // the panel, the tab counts, the table and the chase-list all describe one slice.
    const inContext = <
      T extends { programmeId: string | null; roundId: string | null; tags: string[] },
    >(
      rows: T[],
    ) =>
      rows.filter(
        (r) =>
          (!data?.programmeId || r.programmeId === data.programmeId) &&
          (!data?.roundId || r.roundId === data.roundId) &&
          (!data?.tag || r.tags.includes(data.tag)),
      )
    const scopedUpcoming = inContext(upcoming)

    // The received-date window applies to arrived reports only, and is applied here
    // rather than beside the tab filter so the tab COUNTS sit inside it too — a tab
    // reading 12 above a table showing 3 is the bug this ordering prevents.
    const inWindow = (submittedAt: string) =>
      (!data?.from || submittedAt.slice(0, 10) >= data.from) &&
      (!data?.to || submittedAt.slice(0, 10) <= data.to)
    const scopedItems = inContext(items).filter((i) => inWindow(i.submittedAt))

    const totals = {
      received: scopedItems.filter((i) => i.status === 'received').length,
      reviewed: scopedItems.filter((i) => i.status === 'reviewed').length,
      overdue: scopedUpcoming.filter((i) => i.status === 'overdue').length,
      dueSoon: scopedUpcoming.filter((i) => i.status === 'due_soon').length,
      outstanding: scopedUpcoming.length,
    }

    // The tab is a server-side filter so that the page is a page of the tab, not a page
    // of everything with the tab applied afterwards. `upcoming` is the drawer's
    // chase-list — short by nature, and read as a whole — so it stays unpaged.
    const filtered = data?.status
      ? scopedItems.filter((i) => i.status === data.status)
      : scopedItems
    const sorted = sortRows(
      filtered,
      { by: data?.sortBy, dir: data?.sortDir },
      {
        organisation: (i) => i.organisationName,
        programme: (i) => i.programmeName,
        round: (i) => i.roundName,
        report: (i) => i.label,
        received: (i) => i.submittedAt,
        // Unread before read: `received` is a report waiting on someone.
        status: (i) => (i.status === 'received' ? 0 : 1),
      },
    )
    return { ...paginate(sorted, data?.page), upcoming: scopedUpcoming, totals, facets }
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
