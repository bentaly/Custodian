// ─── What a foundation is owed in the coming week ────────────────────────────
//
// The reporting-milestone twin of `server/financeDigest/query.ts`, and it carries the
// same scoping rule for the same reason: a cron has no session, so
// `visibleRoundProgrammeIds` / `assertClientAccess` are neither available nor
// applicable. This function REQUIRES a clientId and filters `awards.client_id`
// directly, and there is deliberately no "all clients" variant to reach for by
// accident — the failure mode is emailing one foundation's grantee list to another
// foundation's admin.
//
// Its own query rather than a reuse of `server/reports/query.ts`'s `outstandingQuery`,
// which is the Reports screen's chase list. That one answers "everything still waited
// on, ever", against a 30-day `DUE_SOON_DAYS` horizon, and it is read with a session.
// This one is a seven-day window with no session. On WHICH ROWS COUNT the two now agree
// exactly, and must keep agreeing: this email is a Monday prompt to go and act on what
// that screen shows, so a row in one and not the other is a chase with nowhere to land.
import { and, asc, eq, isNull, lte, ne } from 'drizzle-orm'
import {
  applications,
  awards,
  programmes,
  reportSchedule,
  roundProgrammes,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { addDaysIso, daysBetweenIso, todayIso } from '../../lib/schedule'
import type { ReportDigestItem } from '../../lib/reportsDigest/types'

type Db = ReturnType<typeof getDb>

/**
 * Days ahead the digest looks. Seven, matching the payments digest and for the same
 * reason: this email is the week's work, not the Reports screen's 30-day planning
 * horizon. A month of upcoming milestones repeated every Monday is the same list four
 * times over, which is how a recurring email teaches people it contains nothing new.
 */
export const REPORT_DIGEST_WINDOW_DAYS = 7

export interface ReportDigestWindow {
  /** Unsubmitted and dated before today, however old. */
  overdue: ReportDigestItem[]
  /** Unsubmitted, dated today through today + `REPORT_DIGEST_WINDOW_DAYS`. */
  dueThisWeek: ReportDigestItem[]
}

/**
 * Outstanding reporting milestones for one client, split at today.
 *
 * `report_schedule.due_date` is NOT NULL, so there is no "TBC" case to exclude the way
 * the payments digest excludes undated instalments.
 *
 * **Cancelled grants are excluded**, matching `outstandingQuery` (the Reports screen's
 * chase list) and the dashboard's outstanding-reports panel. Neither of those excluded
 * them until 2026-09-17: building this email is what found it, because "would we really
 * SEND this?" is a harder test of a query than "would we really draw it". A withdrawn
 * grant is owed nothing, and an admin told on a Monday morning to chase a charity for a
 * report on a grant the foundation cancelled writes the letter.
 *
 * `completed` awards are NOT excluded. By `awardCompletion`'s rule a completed grant has
 * every milestone received, so it contributes nothing here — except for an onboarding
 * import, which takes the workbook's status verbatim and warns rather than corrects. A
 * milestone still open on one of those is genuinely still owed, and is exactly what an
 * admin wants to see.
 */
export async function reportDigestWindow(db: Db, clientId: string): Promise<ReportDigestWindow> {
  const today = todayIso()
  const horizon = addDaysIso(today, REPORT_DIGEST_WINDOW_DAYS)

  const rows = await db
    .select({
      awardId: awards.id,
      organisationName: applications.organisationName,
      programmeName: programmes.name,
      label: reportSchedule.label,
      dueDate: reportSchedule.dueDate,
    })
    .from(reportSchedule)
    .innerJoin(awards, eq(awards.id, reportSchedule.awardId))
    .innerJoin(applications, eq(applications.id, awards.applicationId))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .where(
      and(
        eq(awards.clientId, clientId),
        ne(awards.status, 'cancelled'),
        isNull(reportSchedule.submittedDate),
        lte(reportSchedule.dueDate, horizon),
      ),
    )
    .orderBy(asc(reportSchedule.dueDate), asc(applications.organisationName))

  const items: ReportDigestItem[] = rows.map((r) => ({
    awardId: r.awardId,
    organisationName: r.organisationName,
    programmeName: r.programmeName,
    label: r.label,
    dueDate: r.dueDate,
    daysLate: daysBetweenIso(r.dueDate, today),
  }))

  return {
    overdue: items.filter((i) => i.dueDate < today),
    dueThisWeek: items.filter((i) => i.dueDate >= today),
  }
}
