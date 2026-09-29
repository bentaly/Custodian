// Server functions for correcting a report. The rules live in `server/reports/correct.ts`;
// these check who is asking (admins only, as with every other change to a report) and
// scope to their foundation.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { awards, reportSchedule, reports } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { notFoundError } from '../../lib/errors'
import { moveReport, rerunReportAnalysis, returnReport, setReportImpact } from '../reports/correct'
import { grantChoices } from './heldReports'

async function assertReportAccess(user: { role: string; clientId: string | null }, id: string) {
  const report = await getDb().query.reports.findFirst({
    where: eq(reports.id, id),
    columns: { id: true, clientId: true },
  })
  if (!report) throw notFoundError()
  assertClientAccess(user, report.clientId)
  return report
}

/** The grants a report can be moved to: every grant the foundation has made. */
export const reportGrantChoices = createServerFn({ method: 'GET' })
  .validator(z.object({ reportId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const report = await assertReportAccess(user, data.reportId)
    return grantChoices(report.clientId)
  })

/** One grant's reporting milestones, and which are already answered by another report. */
export const grantMilestones = createServerFn({ method: 'GET' })
  .validator(z.object({ reportId: z.uuid(), awardId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const report = await assertReportAccess(user, data.reportId)
    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.awardId),
      columns: { clientId: true },
    })
    if (!award || award.clientId !== report.clientId) throw notFoundError()
    const [milestones, answered] = await Promise.all([
      getDb().query.reportSchedule.findMany({
        where: eq(reportSchedule.awardId, data.awardId),
        orderBy: [asc(reportSchedule.dueDate)],
      }),
      getDb().query.reports.findMany({
        where: eq(reports.awardId, data.awardId),
        columns: { id: true, scheduleId: true },
      }),
    ])
    const answeredBy = new Map(
      answered.filter((r) => r.scheduleId).map((r) => [r.scheduleId!, r.id]),
    )
    return milestones.map((m) => ({
      id: m.id,
      label: m.label,
      dueDate: m.dueDate,
      // Answered by a DIFFERENT report: not somewhere this one can go.
      taken: answeredBy.has(m.id) && answeredBy.get(m.id) !== data.reportId,
    }))
  })

export const moveReportFn = createServerFn({ method: 'POST' })
  .validator(z.object({ reportId: z.uuid(), awardId: z.uuid(), scheduleId: z.uuid().nullable() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertReportAccess(user, data.reportId)
    await moveReport({ ...data, actor: { id: user.id } })
    return { ok: true }
  })

export const setReportImpactFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ reportId: z.uuid(), quantity: z.number().min(0).max(1_000_000_000).nullable() }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertReportAccess(user, data.reportId)
    await setReportImpact({ ...data, actor: { id: user.id } })
    return { ok: true }
  })

export const rerunReportAnalysisFn = createServerFn({ method: 'POST' })
  .validator(z.object({ reportId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertReportAccess(user, data.reportId)
    await rerunReportAnalysis(data.reportId, { id: user.id })
    return { ok: true }
  })

/** "Wrong grant?" → send it back: the report returns to the reports that need a grant. */
export const returnReportFn = createServerFn({ method: 'POST' })
  .validator(z.object({ reportId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    await assertReportAccess(user, data.reportId)
    await returnReport({ reportId: data.reportId, actor: { id: user.id } })
    return { ok: true }
  })
