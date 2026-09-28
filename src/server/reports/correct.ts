// ─── Correcting a report after it has landed ─────────────────────────────────
//
// A report is attached to a grant and ticks a milestone automatically (an exact
// reference) or by a person's choice (the Reports screen, the admin app). Either can be
// wrong: the reference belonged to the charity's OTHER grant, or the report is their
// year-two report and ticked year one because year one was still open. And the impact
// figure, which Insights totals, is the model's reading of prose and can be missing or
// wrong. These are the corrections, each recorded in the audit trail.
//
// Moving a report does not re-run its analysis (which compared it with the grant it was
// on): the screen offers "Re-run analysis", as it does for an application's assessment.

import { and, eq, ne, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { getDb } from '../db'
import { auditLog, awards, reportSchedule, reports } from '../../../drizzle/schema'
import { conflict, notFoundError } from '../../lib/errors'
import { recomputeAwardStatus } from '../awards/status'
import { recordAudit } from '../audit'
import { enqueue } from '../pipelineQueue'
import { analyseReport } from './analyse'

type Actor = { id: string }

/** Re-runs per report per 24 hours: each is a paid model call. */
export const REPORT_RERUNS_PER_DAY = 5

async function loadReport(reportId: string) {
  const report = await getDb().query.reports.findFirst({ where: eq(reports.id, reportId) })
  if (!report) throw notFoundError()
  return report
}

async function applicationOf(awardId: string): Promise<string | null> {
  const row = await getDb().query.awards.findFirst({
    where: eq(awards.id, awardId),
    columns: { applicationId: true },
  })
  return row?.applicationId ?? null
}

/**
 * Put a report on a different grant and/or milestone. `scheduleId` null leaves it
 * answering no milestone ("unscheduled"). The milestone it leaves is un-ticked when no
 * other report answers it (the tick was this report's doing); the one it joins is ticked
 * with the date the report arrived. Both grants' statuses are recomputed, since a
 * milestone answered or reopened can complete or reopen a grant.
 */
export async function moveReport(params: {
  reportId: string
  awardId: string
  scheduleId: string | null
  actor: Actor
}): Promise<void> {
  const db = getDb()
  const report = await loadReport(params.reportId)
  const target = await db.query.awards.findFirst({
    where: eq(awards.id, params.awardId),
    columns: { id: true, clientId: true, applicationId: true },
  })
  // Never across foundations.
  if (!target || target.clientId !== report.clientId) throw notFoundError()

  if (params.scheduleId) {
    const milestone = await db.query.reportSchedule.findFirst({
      where: eq(reportSchedule.id, params.scheduleId),
    })
    if (!milestone || milestone.awardId !== target.id) {
      throw conflict('That reporting milestone belongs to a different grant.')
    }
    const other = await db.query.reports.findFirst({
      where: and(eq(reports.scheduleId, params.scheduleId), ne(reports.id, report.id)),
      columns: { id: true },
    })
    if (other) throw conflict('Another report already answers that milestone.')
  }
  if (report.awardId === target.id && report.scheduleId === params.scheduleId) return

  const arrived = report.submittedAt.toISOString().slice(0, 10)
  const statements: BatchItem<'pg'>[] = [
    db
      .update(reports)
      .set({ awardId: target.id, scheduleId: params.scheduleId })
      .where(eq(reports.id, report.id)),
  ]
  if (report.scheduleId && report.scheduleId !== params.scheduleId) {
    // Un-tick the milestone it leaves, unless another report still answers it.
    statements.push(
      db
        .update(reportSchedule)
        .set({ submittedDate: null })
        .where(
          and(
            eq(reportSchedule.id, report.scheduleId),
            sql`not exists (select 1 from ${reports} where ${reports.scheduleId} = ${report.scheduleId} and ${reports.id} <> ${report.id})`,
          ),
        ),
    )
  }
  if (params.scheduleId) {
    statements.push(
      db
        .update(reportSchedule)
        .set({ submittedDate: arrived })
        .where(
          and(
            eq(reportSchedule.id, params.scheduleId),
            sql`${reportSchedule.submittedDate} is null`,
          ),
        ),
    )
  }
  await db.batch(statements as [BatchItem<'pg'>, ...BatchItem<'pg'>[]])

  await recomputeAwardStatus(target.id)
  if (report.awardId !== target.id) await recomputeAwardStatus(report.awardId)

  const applicationId = target.applicationId ?? (await applicationOf(report.awardId))
  await recordAudit({
    actorUserId: params.actor.id,
    action: 'report_moved',
    ...(applicationId ? { applicationId } : { clientId: report.clientId }),
    metadata: {
      reportId: report.id,
      fromAwardId: report.awardId,
      toAwardId: target.id,
      fromScheduleId: report.scheduleId,
      toScheduleId: params.scheduleId,
    },
  })
}

/**
 * Correct the report's impact figure. It is stored with source `edited`, which no
 * re-analysis replaces (`analyse.ts`). Null means "this report evidences no figure":
 * a statement, so it too is `edited`, not a return to the model's reading.
 */
export async function setReportImpact(params: {
  reportId: string
  quantity: number | null
  actor: Actor
}): Promise<void> {
  const report = await loadReport(params.reportId)
  await getDb()
    .update(reports)
    .set({
      impactQuantity: params.quantity === null ? null : String(params.quantity),
      impactQuantitySource: 'edited',
      impactQuantityQuote: null,
    })
    .where(eq(reports.id, report.id))
  const applicationId = await applicationOf(report.awardId)
  await recordAudit({
    actorUserId: params.actor.id,
    action: 'report_impact_changed',
    ...(applicationId ? { applicationId } : { clientId: report.clientId }),
    metadata: {
      reportId: report.id,
      from: report.impactQuantity,
      fromSource: report.impactQuantitySource,
      to: params.quantity,
    },
  })
}

export type ReportRerunBlocker = {
  code: 'unavailable' | 'unchanged' | 'capped'
  message: string
}

/**
 * Why "Re-run analysis" is not on offer, or null. The analysis compares a report with
 * its grant, so it is worth re-running after the report MOVES (or after a failed run),
 * and not otherwise. At most REPORT_RERUNS_PER_DAY in 24 hours.
 */
export async function reportRerunBlocker(reportId: string): Promise<ReportRerunBlocker | null> {
  const db = getDb()
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    columns: { id: true, analysisStatus: true, importBatchId: true },
  })
  if (!report) return { code: 'unavailable', message: 'Not found.' }
  if (report.analysisStatus === 'queued') {
    return { code: 'unavailable', message: 'The analysis is already running.' }
  }
  const [moved, recent] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'report_moved'),
          sql`${auditLog.metadata}->>'reportId' = ${reportId}`,
          // Column against column, in the database: see `rerunBlocker` for why a
          // timestamp must not round-trip through a JS Date here.
          sql`${auditLog.createdAt} > coalesce((select ${reports.analysedAt} from ${reports} where ${reports.id} = ${reportId}), '-infinity'::timestamp)`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'report_analysis_rerun'),
          sql`${auditLog.metadata}->>'reportId' = ${reportId}`,
          sql`${auditLog.createdAt} > now() - interval '1 day'`,
        ),
      ),
  ])
  if (report.analysisStatus !== 'error' && (moved[0]?.n ?? 0) === 0) {
    return { code: 'unchanged', message: 'Nothing has changed since the report was analysed.' }
  }
  if ((recent[0]?.n ?? 0) >= REPORT_RERUNS_PER_DAY) {
    return {
      code: 'capped',
      message: `The analysis has been re-run ${REPORT_RERUNS_PER_DAY} times in the last 24 hours, the most allowed. It can be re-run again tomorrow.`,
    }
  }
  return null
}

export async function rerunReportAnalysis(reportId: string, actor: Actor): Promise<void> {
  const blocker = await reportRerunBlocker(reportId)
  if (blocker) throw conflict(blocker.message)
  const report = await loadReport(reportId)
  await getDb().update(reports).set({ analysisStatus: 'queued' }).where(eq(reports.id, reportId))
  const applicationId = await applicationOf(report.awardId)
  await recordAudit({
    actorUserId: actor.id,
    action: 'report_analysis_rerun',
    ...(applicationId ? { applicationId } : { clientId: report.clientId }),
    metadata: { reportId },
  })
  await enqueue({ kind: 'report_analysis', reportId }, () => analyseReport(reportId))
}
