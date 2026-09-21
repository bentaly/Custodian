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
 * report, so it is not in a list of them. Nor is it on the grant's own line or among its
 * submissions (`grantTimeline`), where it wore a "Received" pill and a "Reported 100
 * young people" sentence on a grant that had sent nothing; and `getReport` refuses it a
 * page, because there is no document to read. The figure itself is shown on the grant's
 * impact card, which says where it came from.
 *
 * So this label now names the row in code rather than on screen. It stays because the
 * rule it states is the one every one of those places enforces, and because the moment
 * something DOES surface the row again, it must be called this and not "report".
 */
export const UNSCHEDULED_REPORT_LABEL = 'Unscheduled report'
export const IMPORTED_FIGURE_LABEL = 'Imported impact figure'

export function reportLabel(milestoneLabel: string | null | undefined, imported: boolean): string {
  return milestoneLabel ?? (imported ? IMPORTED_FIGURE_LABEL : UNSCHEDULED_REPORT_LABEL)
}
