import { notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { reportSchedule, awards, reports } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { dueStatus, type DueStatus } from '../../lib/schedule'
import { type FacetOption } from '../../lib/facets'
import { PAGE_SIZE } from '../../lib/pagination'
import {
  arrivedQuery,
  outstandingQuery,
  structuralWhere,
  type ArrivedQuery,
  type ArrivedRow,
  type OutstandingQuery,
} from '../reports/query'

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
    if (!user.clientId) return emptyReportsList()
    return reportsList(getDb(), user.clientId, data ?? {})
  })

/** Everything the screen is filtered, sorted and paged by — the validator's shape. */
export type ReportsListInput = {
  status?: ReceivedStatus
  programmeId?: string
  roundId?: string
  tag?: string
  from?: string
  to?: string
  sortBy?: ReportSortKey
  sortDir?: 'asc' | 'desc'
  page?: number
}

type ReportSortKey = 'organisation' | 'programme' | 'round' | 'report' | 'received' | 'status'

/**
 * The Reports screen, as a plain function of (connection, tenant, filters) — the same
 * seam Finance and Awards have, so everything below the auth check runs without a
 * session.
 *
 * One `db.batch()`: the table's page, its count, both tab counts, the chase-list, the
 * outstanding tallies and three facets. One round trip, one snapshot, so the drawer's
 * badge cannot disagree with the drawer.
 */
export async function reportsList(
  db: ReturnType<typeof getDb>,
  clientId: string,
  data: ReportsListInput,
) {
  const arrived = arrivedQuery(db, clientId)
  const outstanding = outstandingQuery(db, clientId)
  const page = data.page && data.page > 0 ? data.page : 1

  // The structural filters narrow both lists. The received-date window narrows the
  // arrived one only — see `structuralWhere` on why the drawer is left out of it.
  const arrivedWhere = and(
    structuralWhere(arrived, data),
    data.from ? sql`${arrived.submittedDay} >= ${data.from}` : undefined,
    data.to ? sql`${arrived.submittedDay} <= ${data.to}` : undefined,
  )
  const onTab = (status: ReceivedStatus) => and(arrivedWhere, eq(arrived.status, status))
  const outstandingWhere = structuralWhere(outstanding, data)

  const countArrived = (where: SQL | undefined) =>
    db
      .select({ n: sql<number>`(count(*))::int` })
      .from(arrived)
      .where(where)

  // Facets are counted over BOTH lists and before the filters: a round whose reports are
  // all still outstanding is exactly the round you want to be able to pick, and one
  // counted over arrived reports alone would leave it out of the pill entirely.
  const facetOn = (q: ArrivedQuery | OutstandingQuery, value: SQLWrapper, label: SQLWrapper) =>
    db
      .select({
        value: value as SQL<string | null>,
        label: label as SQL<string | null>,
        count: sql<number>`(count(*))::int`,
      })
      .from(q as ArrivedQuery)
      .groupBy(value as SQL, label as SQL)
  const themeFacet = (q: ArrivedQuery | OutstandingQuery) =>
    db
      .select({
        value: sql<string>`theme.value`,
        label: sql<string>`theme.value`,
        count: sql<number>`(count(*))::int`,
      })
      .from(q as ArrivedQuery)
      .innerJoin(sql`lateral jsonb_array_elements_text(${q.tags}) as theme(value)`, sql`true`)
      .groupBy(sql`theme.value`)

  const [
    rows,
    tabAll,
    tabReceived,
    tabReviewed,
    chase,
    dueTallies,
    progA,
    progO,
    themeA,
    themeO,
    roundA,
    roundO,
  ] = await db.batch([
    db
      .select()
      .from(arrived)
      .where(data.status ? onTab(data.status) : arrivedWhere)
      .orderBy(...orderFor(arrived, data.sortBy, data.sortDir))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    countArrived(arrivedWhere),
    countArrived(onTab('received')),
    countArrived(onTab('reviewed')),
    // The chase-list is short by nature and read as a whole, so it stays unpaged —
    // most overdue first, because it is ordered by urgency rather than by recency.
    db
      .select()
      .from(outstanding)
      .where(outstandingWhere)
      .orderBy(sql`${outstanding.dueDate} asc`),
    db
      .select({
        overdue: sql<number>`(count(*) filter (where ${outstanding.status} = 'overdue'))::int`,
        dueSoon: sql<number>`(count(*) filter (where ${outstanding.status} = 'due_soon'))::int`,
        outstanding: sql<number>`(count(*))::int`,
      })
      .from(outstanding)
      .where(outstandingWhere),
    facetOn(arrived, arrived.programmeId, arrived.programmeName),
    facetOn(outstanding, outstanding.programmeId, outstanding.programmeName),
    themeFacet(arrived),
    themeFacet(outstanding),
    facetOn(arrived, arrived.roundId, arrived.roundName),
    facetOn(outstanding, outstanding.roundId, outstanding.roundName),
  ])

  // `total` is the count of the OPEN tab — it is what the pager reads, so it has to be
  // the size of the list being paged rather than of everything behind the tabs.
  const total =
    data.status === 'received'
      ? (tabReceived[0]?.n ?? 0)
      : data.status === 'reviewed'
        ? (tabReviewed[0]?.n ?? 0)
        : (tabAll[0]?.n ?? 0)

  return {
    items: rows.map(toReportRow),
    total,
    page,
    pageSize: PAGE_SIZE,
    upcoming: chase.map((r) => ({
      key: r.key,
      awardId: r.awardId,
      applicationId: r.applicationId,
      organisationName: r.organisationName,
      programmeId: r.programmeId,
      programmeName: r.programmeName,
      roundId: r.roundId,
      roundName: r.roundName,
      tags: (r.tags as string[] | null) ?? [],
      label: r.label,
      dueDate: r.dueDate,
      status: r.status as DueStatus,
    })),
    totals: {
      received: tabReceived[0]?.n ?? 0,
      reviewed: tabReviewed[0]?.n ?? 0,
      ...dueTallies[0]!,
    },
    facets: {
      programmes: mergeFacets(progA, progO, 'Untitled programme'),
      themes: mergeFacets(themeA, themeO, ''),
      rounds: mergeFacets(roundA, roundO, 'Untitled round'),
    },
  }
}

/** A tenant-less caller (a superadmin with no client) still gets the screen's shape. */
export function emptyReportsList(): Awaited<ReturnType<typeof reportsList>> {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    upcoming: [],
    totals: emptyTotals(),
    facets: { programmes: [], themes: [], rounds: [] },
  }
}

/**
 * One facet over two lists. A programme with three reports in and two still owed reads
 * as five, which is what the count means here: how much of this screen it accounts for.
 */
function mergeFacets(
  a: Array<{ value: string | null; label: string | null; count: number }>,
  b: Array<{ value: string | null; label: string | null; count: number }>,
  fallback: string,
): FacetOption[] {
  const out = new Map<string, FacetOption>()
  for (const row of [...a, ...b]) {
    if (row.value === null) continue
    const existing = out.get(row.value)
    if (existing) existing.count += row.count
    else out.set(row.value, { value: row.value, label: row.label ?? fallback, count: row.count })
  }
  return [...out.values()].sort((x, y) => x.label.localeCompare(y.label))
}

/** The row the table renders, with the submission it opens. */
function toReportRow(r: ArrivedRow) {
  return {
    key: r.key,
    awardId: r.awardId,
    applicationId: r.applicationId,
    organisationName: r.organisationName,
    programmeId: r.programmeId,
    programmeName: r.programmeName,
    roundId: r.roundId,
    roundName: r.roundName,
    tags: (r.tags as string[] | null) ?? [],
    label: r.label,
    dueDate: r.dueDate,
    submittedAt: r.submittedAt,
    status: r.status as ReceivedStatus,
    submission: {
      id: r.key,
      submittedAt: r.submittedAt,
      impactSummary: r.impactSummary,
      challenges: r.challenges,
      lessons: r.lessons,
      analysisStatus: r.analysisStatus,
      aiSummary: r.aiSummary,
      aiChallenges: r.aiChallenges,
      aiLessons: r.aiLessons,
      applicationAlignment: r.applicationAlignment,
      programmeAlignment: r.programmeAlignment,
      impactQuantity: r.impactQuantity,
      impactQuantitySource: r.impactQuantitySource,
      impactQuantityQuote: r.impactQuantityQuote,
      impactUnitLabel: r.impactUnitLabel,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      flags: (r.flags as string[] | null) ?? [],
    },
  }
}

/**
 * Column sort, in SQL. Text sorts case-insensitively with NULLs last; with no explicit
 * sort the newest report is first, because it is the one you came to read.
 */
function orderFor(
  q: ArrivedQuery,
  by: ReportSortKey | undefined,
  dir: 'asc' | 'desc' | undefined,
): SQL[] {
  const d = sql.raw(dir === 'asc' ? 'asc' : 'desc')
  const text = (col: SQLWrapper) => sql`lower(${col}) ${d} nulls last`
  switch (by) {
    case 'organisation':
      return [text(q.organisationName)]
    case 'programme':
      return [text(q.programmeName)]
    case 'round':
      return [text(q.roundName)]
    case 'report':
      return [text(q.label)]
    case 'received':
      return [sql`${q.submittedAt} ${d}`]
    // Unread before read: `received` is a report waiting on someone.
    case 'status':
      return [sql`case ${q.status} when 'received' then 0 else 1 end ${d}`]
    default:
      return [sql`${q.submittedAt} desc`]
  }
}

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
