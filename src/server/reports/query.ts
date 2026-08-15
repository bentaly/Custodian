import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import {
  applications,
  awards,
  programmes,
  reports,
  reportSchedule,
  rounds,
  roundProgrammes,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { DUE_SOON_DAYS, addDaysIso, todayIso } from '../../lib/schedule'

/**
 * The Reports screen, expressed as SQL — the third screen on the pattern set by
 * `server/finance/query.ts`. It used to load every award the client has ever made, with
 * its whole reporting schedule and every report submitted against it, to render 25 rows.
 *
 * Two subqueries, because the screen genuinely is two things (and the schema has always
 * said so):
 *
 *   arrived    — reports that EXIST: `reports` ⋈ its award ⋈ the milestone it answered.
 *                One row per document. The screen's table.
 *   outstanding — dates still WAITED ON: schedule rows with nothing against them, with
 *                `status` derived from the due date exactly as `lib/schedule`'s
 *                `dueStatus` does. The chase-list drawer.
 *
 * A milestone that has been answered is in the first and not the second; an unscheduled
 * report is in the first with no milestone at all. Keeping them apart is what stopped a
 * never-submitted date from looking like a report.
 */

type Db = ReturnType<typeof getDb>

/** The programme/round/theme columns every row carries, aliased so nothing is ambiguous. */
function grantColumns() {
  return {
    awardId: sql<string>`${awards.id}`.as('award_id'),
    applicationId: sql<string>`${applications.id}`.as('application_id'),
    organisationName: sql<string>`${applications.organisationName}`.as('organisation_name'),
    programmeId: sql<string | null>`${roundProgrammes.programmeId}`.as('programme_id'),
    programmeName: sql<string | null>`${programmes.name}`.as('programme_name'),
    roundId: sql<string | null>`${rounds.id}`.as('round_id'),
    roundName: sql<string | null>`${rounds.name}`.as('round_name'),
    tags: sql<unknown>`${programmes.tags}`.as('tags'),
  }
}

/**
 * Reports that have arrived.
 *
 * `submitted_at` is formatted rather than converted, for the reason spelled out in
 * `server/awards/query.ts`: the column is a naive timestamp holding UTC, and
 * `AT TIME ZONE` would move a report submitted late in the evening to the wrong day.
 */
export function arrivedQuery(db: Db, clientId: string) {
  return db
    .select({
      ...grantColumns(),
      key: sql<string>`${reports.id}`.as('key'),
      label: sql<string>`coalesce(${reportSchedule.label}, 'Unscheduled report')`.as('label'),
      dueDate: sql<string | null>`${reportSchedule.dueDate}`.as('due_date'),
      submittedAt: sql<string>`to_char(${reports.submittedAt}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as(
        'submitted_at',
      ),
      /** The day alone, so a `from` of the 3rd includes reports that arrived on the 3rd. */
      submittedDay: sql<string>`to_char(${reports.submittedAt}, 'YYYY-MM-DD')`.as('submitted_day'),
      status:
        sql<string>`case when ${reports.reviewedAt} is null then 'received' else 'reviewed' end`.as(
          'status',
        ),
      // The submission itself, column by column. The jsonb `analysis_detail` never
      // crosses the wire whole — only the flags array the screen reads — because the
      // server-fn serializer rejects loosely-typed jsonb.
      impactSummary: sql<string | null>`${reports.impactSummary}`.as('impact_summary'),
      challenges: sql<string | null>`${reports.challenges}`.as('challenges'),
      lessons: sql<string | null>`${reports.lessons}`.as('lessons'),
      analysisStatus: sql<string | null>`${reports.analysisStatus}`.as('analysis_status'),
      aiSummary: sql<string | null>`${reports.aiSummary}`.as('ai_summary'),
      aiChallenges: sql<string | null>`${reports.aiChallenges}`.as('ai_challenges'),
      aiLessons: sql<string | null>`${reports.aiLessons}`.as('ai_lessons'),
      applicationAlignment: sql<string | null>`${reports.applicationAlignment}`.as(
        'application_alignment',
      ),
      programmeAlignment: sql<string | null>`${reports.programmeAlignment}`.as(
        'programme_alignment',
      ),
      impactQuantity: sql<number | null>`${reports.impactQuantity}`.as('impact_quantity'),
      impactQuantitySource: sql<string | null>`${reports.impactQuantitySource}`.as(
        'impact_quantity_source',
      ),
      impactQuantityQuote: sql<string | null>`${reports.impactQuantityQuote}`.as(
        'impact_quantity_quote',
      ),
      impactUnitLabel: sql<string | null>`${reports.impactUnitLabel}`.as('impact_unit_label'),
      reviewedAt: sql<
        string | null
      >`to_char(${reports.reviewedAt}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('reviewed_at'),
      reviewedBy: sql<string | null>`${reports.reviewedBy}`.as('reviewed_by'),
      flags: sql<string[]>`coalesce(${reports.analysisDetail} -> 'flags', '[]'::jsonb)`.as('flags'),
    })
    .from(reports)
    .innerJoin(awards, eq(awards.id, reports.awardId))
    .leftJoin(reportSchedule, eq(reportSchedule.id, reports.scheduleId))
    .innerJoin(applications, eq(applications.id, awards.applicationId))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .leftJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
    .where(eq(awards.clientId, clientId))
    .as('arrived')
}

/**
 * Dates still waited on: a schedule row with nothing submitted against it.
 *
 * `status` is `dueStatus` in SQL — the same three-way ladder, against the same
 * `DUE_SOON_DAYS` window, so the drawer's red count and the library agree by
 * construction rather than by both being edited together.
 */
export function outstandingQuery(db: Db, clientId: string) {
  const today = todayIso()
  const soon = addDaysIso(today, DUE_SOON_DAYS)
  return db
    .select({
      ...grantColumns(),
      key: sql<string>`${reportSchedule.id}`.as('key'),
      label: sql<string>`${reportSchedule.label}`.as('label'),
      dueDate: sql<string>`${reportSchedule.dueDate}`.as('due_date'),
      status: sql<string>`case
        when ${reportSchedule.dueDate} < ${today} then 'overdue'
        when ${reportSchedule.dueDate} <= ${soon} then 'due_soon'
        else 'upcoming'
      end`.as('status'),
    })
    .from(reportSchedule)
    .innerJoin(awards, eq(awards.id, reportSchedule.awardId))
    .innerJoin(applications, eq(applications.id, awards.applicationId))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .leftJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
    .where(and(eq(awards.clientId, clientId), isNull(reportSchedule.submittedDate)))
    .as('outstanding')
}

export type ArrivedQuery = ReturnType<typeof arrivedQuery>
export type OutstandingQuery = ReturnType<typeof outstandingQuery>

export function arrivedRows(db: Db, q: ArrivedQuery) {
  return db.select().from(q)
}
export type ArrivedRow = Awaited<ReturnType<typeof arrivedRows>>[number]

export function outstandingRows(db: Db, q: OutstandingQuery) {
  return db.select().from(q)
}
export type OutstandingRow = Awaited<ReturnType<typeof outstandingRows>>[number]

/**
 * The structural filters — programme, round, theme.
 *
 * On this screen they narrow BOTH lists: "reports for this programme" is a question
 * about the table and the chase-list alike. The received-date window is not here for
 * exactly that reason — it is a fact about documents that arrived, and applying it to
 * dates still waited on would empty the drawer whenever the window was used.
 */
export function structuralWhere(
  q: { programmeId: any; roundId: any; tags: any },
  f: { programmeId?: string; roundId?: string; tag?: string },
): SQL | undefined {
  return and(
    f.programmeId ? eq(q.programmeId, f.programmeId) : undefined,
    f.roundId ? eq(q.roundId, f.roundId) : undefined,
    f.tag ? sql`${q.tags} @> ${JSON.stringify([f.tag])}::jsonb` : undefined,
  )
}
