// A report exactly as the grantee sent it, for View Report: every answer, in their
// wording and their order, straight from the stored submission. The twin of an
// application's `submittedFields`, but derived on read rather than indexed at
// promotion, because a report's columns are never edited: the only thing Custodian
// ever reads differently is the impact figure, and that lives on the report row.
//
// `unreadFigure` is the one answer the pipeline could not use: the figure question,
// answered with something that is not a whole number ("about 60", "12.5"). The report
// lands without it rather than being held, and the screen says so beside the figure.

import { inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { reportIngests } from '../../../drizzle/schema'
import { toStringValue } from '../../lib/fieldMapping'
import { orderedKeys } from '../fieldMapping/assemble'

export interface ReportAsSent {
  answers: Array<{ label: string; value: string; canonical: string | null }>
  /** The figure question and their answer, when it could not be read as a number. */
  unreadFigure: { question: string; answer: string } | null
}

/**
 * One query for any number of reports. A report with no stored submission (an
 * imported figure) is absent from the map, and its screen falls back to the columns.
 */
export async function reportsAsSent(
  reports: Array<{ id: string; beneficiaryCount: number | null }>,
): Promise<Map<string, ReportAsSent>> {
  const out = new Map<string, ReportAsSent>()
  if (reports.length === 0) return out
  const rows = await getDb()
    .select({
      reportId: reportIngests.reportId,
      rawPayload: reportIngests.rawPayload,
      fieldOrder: reportIngests.fieldOrder,
      resolved: reportIngests.resolved,
    })
    .from(reportIngests)
    .where(
      inArray(
        reportIngests.reportId,
        reports.map((r) => r.id),
      ),
    )
  const countById = new Map(reports.map((r) => [r.id, r.beneficiaryCount]))
  for (const row of rows) {
    if (!row.reportId) continue
    const resolved = row.resolved ?? {}
    const answers = orderedKeys(row.rawPayload, row.fieldOrder)
      .map((label) => ({
        label,
        value: toStringValue(row.rawPayload[label]),
        canonical: resolved[label] ?? null,
      }))
      .filter((a) => a.value !== '')
    const figure = answers.find((a) => a.canonical === 'beneficiaryCount')
    out.set(row.reportId, {
      answers,
      unreadFigure:
        figure && countById.get(row.reportId) == null
          ? { question: figure.label, answer: figure.value }
          : null,
    })
  }
  return out
}
