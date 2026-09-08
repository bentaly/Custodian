/**
 * What a report row is CALLED when it answers no milestone.
 *
 * Two different things end up with a null `scheduleId`, and calling them the same thing
 * misled a foundation on its own Reports screen:
 *
 *   • A report that genuinely arrived without a milestone to answer — a grantee sent
 *     something nobody asked for on that date. "Unscheduled report" is exactly right.
 *   • A row the onboarding import wrote to carry a historic impact figure the foundation
 *     already held (`reports.import_batch_id`, and the only way Insights can read that
 *     figure). Where the workbook says no report has been received, this row answers
 *     nothing — and calling it an unscheduled report claimed a grantee had submitted one.
 *
 * Where each is reachable: the imported figure is kept OUT of the Reports library, its
 * counts and global search (`isArrivedReport`, `server/reports/query.ts`) — it is not a
 * report, so it is not in a list of them. It still shows on the grant it belongs to,
 * which is the one place a foundation should be able to see where its impact figure
 * came from, and that is what this label names.
 */
export const UNSCHEDULED_REPORT_LABEL = 'Unscheduled report'
export const IMPORTED_FIGURE_LABEL = 'Imported impact figure'

export function reportLabel(milestoneLabel: string | null | undefined, imported: boolean): string {
  return milestoneLabel ?? (imported ? IMPORTED_FIGURE_LABEL : UNSCHEDULED_REPORT_LABEL)
}
