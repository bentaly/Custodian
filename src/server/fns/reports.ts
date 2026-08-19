import { notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../db'
import { reportSchedule, awards, reports } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import {
  addMonthsIso,
  dueStatus,
  endOfMonthIso,
  todayIso,
  type DueStatus,
} from '../../lib/schedule'
import { type FacetOption } from '../../lib/facets'
import { PAGE_SIZE } from '../../lib/pagination'
import {
  arrivedQuery,
  outstandingQuery,
  structuralWhere,
  type ArrivedQuery,
  type ArrivedRow,
  type OutstandingQuery,
  type OutstandingRow,
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
        /** Which stage of the lifecycle is open; absent is the work sitting with you. */
        tab: z.enum(['to_review', 'reviewed', 'awaiting']).optional(),
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
        /** Column sort. `received` belongs to the document tabs, `due` to the awaited one. */
        sortBy: z
          .enum(['organisation', 'programme', 'round', 'report', 'received', 'due'])
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
  /**
   * Which stage of the reporting lifecycle is open. The two document tabs sit together
   * because they hold the same kind of row at two stages; `awaiting` holds a different
   * kind entirely — a date nobody has answered yet — which is why it is last and why
   * its page is a separate query rather than a filter over the same one.
   */
  tab?: ReportsTab
  programmeId?: string
  roundId?: string
  tag?: string
  from?: string
  to?: string
  sortBy?: ReportSortKey
  sortDir?: 'asc' | 'desc'
  page?: number
}

export type ReportsTab = 'to_review' | 'reviewed' | 'awaiting'

type ReportSortKey = 'organisation' | 'programme' | 'round' | 'report' | 'received' | 'due'

/**
 * The Reports screen, as a plain function of (connection, tenant, filters) — the same
 * seam Finance and Awards have, so everything below the auth check runs without a
 * session.
 *
 * One `db.batch()`: a page of each list, all three tab counts, the panel's horizons and
 * three facets. One round trip, one snapshot, so a tab's count cannot disagree with the
 * list behind it. Both page queries always run — each is 25 rows and only one is
 * rendered — which keeps the batch a fixed shape rather than branching on the tab.
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
  const tab: ReportsTab = data.tab ?? 'to_review'

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
    awaitingRows,
    tabToReview,
    tabReviewed,
    tabAwaiting,
    horizonTotals,
    horizonItems,
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
      .where(onTab(tab === 'reviewed' ? 'reviewed' : 'received'))
      .orderBy(...arrivedOrder(arrived, data.sortBy, data.sortDir))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select()
      .from(outstanding)
      .where(outstandingWhere)
      .orderBy(...outstandingOrder(outstanding, data.sortBy, data.sortDir))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    countArrived(onTab('received')),
    countArrived(onTab('reviewed')),
    db
      .select({ n: sql<number>`(count(*))::int` })
      .from(outstanding)
      .where(outstandingWhere),
    horizonCounts(db, outstanding, outstandingWhere),
    horizonSample(db, outstanding, outstandingWhere),
    facetOn(arrived, arrived.programmeId, arrived.programmeName),
    facetOn(outstanding, outstanding.programmeId, outstanding.programmeName),
    themeFacet(arrived),
    themeFacet(outstanding),
    facetOn(arrived, arrived.roundId, arrived.roundName),
    facetOn(outstanding, outstanding.roundId, outstanding.roundName),
  ])

  const tabCounts = {
    to_review: tabToReview[0]?.n ?? 0,
    reviewed: tabReviewed[0]?.n ?? 0,
    awaiting: tabAwaiting[0]?.n ?? 0,
  }

  return {
    // The documents page and the awaited page are separate fields rather than one
    // `items`: they are different entities, and collapsing them is exactly what made a
    // never-submitted milestone look like a report on the screen this replaced.
    items: rows.map(toReportRow),
    awaiting: awaitingRows.map(toAwaitingRow),
    total: tabCounts[tab],
    page,
    pageSize: PAGE_SIZE,
    tabCounts,
    // The panel above the tabs: portfolio-wide by the app's rule that a control narrows
    // only what is below it — except for the structural filters, which are this screen's
    // context and narrow everything.
    horizons: toHorizons(horizonTotals, horizonItems),
    facets: {
      programmes: mergeFacets(progA, progO, 'Untitled programme'),
      themes: mergeFacets(themeA, themeO, ''),
      rounds: mergeFacets(roundA, roundO, 'Untitled round'),
    },
  }
}

/**
 * How many each bucket names before it just says how many more there are.
 *
 * Three, so the three horizon cards stay the same height as each other and as the
 * design (Figma 661:24659). A fourth row makes one card outgrow its neighbours, and a
 * strip of three cards that are not the same height reads as a layout fault rather
 * than as one card having more in it — which the "+n more" line already says.
 */
const HORIZON_SHOWN = 3

/** The three horizons the panel reads, as one CASE both its queries share. */
function horizonOf(q: OutstandingQuery): SQL<string | null> {
  const today = todayIso()
  return sql<string | null>`case
    when ${q.dueDate} < ${today} then 'overdue'
    when ${q.dueDate} <= ${endOfMonthIso(today)} then 'thisMonth'
    when ${q.dueDate} <= ${addMonthsIso(today, 3)} then 'next3Months'
  end`
}

/** Each horizon's count — the panel's headline figures. */
function horizonCounts(db: ReturnType<typeof getDb>, q: OutstandingQuery, where: SQL | undefined) {
  return (
    db
      .select({ bucket: horizonOf(q), count: sql<number>`(count(*))::int` })
      .from(q)
      .where(where)
      // `group by 1`, not the expression again: drizzle binds the dates as fresh
      // parameters each time it emits the CASE, and Postgres matches GROUP BY
      // expressions syntactically, so the repeated version is a different expression.
      .groupBy(sql`1`)
  )
}

/**
 * The first few in each horizon, by date. `row_number()` rather than a query per
 * bucket: a dozen rows however large the portfolio, which is what lets the panel stay
 * honest without loading the schedule.
 */
function horizonSample(db: ReturnType<typeof getDb>, q: OutstandingQuery, where: SQL | undefined) {
  const bucket = horizonOf(q)
  const ranked = db
    .select({
      bucket: bucket.as('bucket'),
      key: sql<string>`${q.key}`.as('key'),
      organisationName: sql<string>`${q.organisationName}`.as('organisation_name'),
      programmeName: sql<string | null>`${q.programmeName}`.as('programme_name'),
      label: sql<string>`${q.label}`.as('label'),
      dueDate: sql<string>`${q.dueDate}`.as('due_date'),
      rank: sql<number>`row_number() over (partition by ${bucket} order by ${q.dueDate}, ${q.key})`.as(
        'rank',
      ),
    })
    .from(q)
    .where(where)
    .as('ranked')
  return db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= ${HORIZON_SHOWN} and ${ranked.bucket} is not null`)
    .orderBy(sql`${ranked.dueDate} asc`)
}

type HorizonKey = 'overdue' | 'thisMonth' | 'next3Months'
type HorizonItem = {
  key: string
  organisationName: string
  programmeName: string | null
  label: string
  dueDate: string
}

function toHorizons(
  counts: Array<{ bucket: string | null; count: number }>,
  items: Array<HorizonItem & { bucket: string | null; rank: number }>,
): Record<HorizonKey, { count: number; items: HorizonItem[] }> {
  const out = {} as Record<HorizonKey, { count: number; items: HorizonItem[] }>
  for (const key of ['overdue', 'thisMonth', 'next3Months'] as HorizonKey[]) {
    out[key] = {
      count: counts.find((c) => c.bucket === key)?.count ?? 0,
      // `bucket` and `rank` are how the query picked these rows; neither is anything the
      // panel renders, so they stop here rather than riding the wire.
      items: items
        .filter((i) => i.bucket === key)
        .map(({ key: k, organisationName, programmeName, label, dueDate }) => ({
          key: k,
          organisationName,
          programmeName,
          label,
          dueDate,
        })),
    }
  }
  return out
}

/** The awaited row: a date nobody has answered yet, and how late it is. */
function toAwaitingRow(r: OutstandingRow) {
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
    status: r.status as DueStatus,
  }
}

/** A tenant-less caller (a superadmin with no client) still gets the screen's shape. */
export function emptyReportsList(): Awaited<ReturnType<typeof reportsList>> {
  const none = { count: 0, items: [] }
  return {
    items: [],
    awaiting: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    tabCounts: { to_review: 0, reviewed: 0, awaiting: 0 },
    horizons: { overdue: none, thisMonth: none, next3Months: none },
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
function arrivedOrder(
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
    default:
      return arrivedOrder(q, REPORTS_ARRIVED_DEFAULT_SORT.by, REPORTS_ARRIVED_DEFAULT_SORT.dir)
  }
}

/** The Received tab's order with nothing clicked — and the arrow its header shows. */
export const REPORTS_ARRIVED_DEFAULT_SORT = { by: 'received', dir: 'desc' } as const satisfies {
  by: ReportSortKey
  dir: 'asc' | 'desc'
}

/**
 * The awaited list's order. It defaults to most overdue first — this tab is a
 * chase-list, so urgency is the order, exactly as the panel above it is ordered. The
 * `received` key has no meaning here (nothing has arrived) and falls through to it.
 */
function outstandingOrder(
  q: OutstandingQuery,
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
    case 'due':
      return [sql`${q.dueDate} ${d}`]
    default:
      return outstandingOrder(q, REPORTS_AWAITED_DEFAULT_SORT.by, REPORTS_AWAITED_DEFAULT_SORT.dir)
  }
}

/** The Awaited tab's order with nothing clicked — most overdue first, and the arrow its
 *  header shows. Deliberately a different column from the Received tab's: the two tabs
 *  answer different questions, so they cannot share one default. */
export const REPORTS_AWAITED_DEFAULT_SORT = { by: 'due', dir: 'asc' } as const satisfies {
  by: ReportSortKey
  dir: 'asc' | 'desc'
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
          columns: {
            id: true,
            organisationName: true,
            deliveryArea: true,
            amountRequested: true,
            // The address to chase an overdue report at, and the foundation's own
            // reference for the grant to put in the subject line.
            applicantEmail: true,
            externalApplicationId: true,
          },
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
      applicantEmail: award.application.applicantEmail,
      reference: award.application.externalApplicationId,
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
