// ─── The weekly reports digest ───────────────────────────────────────────────
//
// The payments digest's twin: a Monday email, on the same Cron Trigger, telling an
// admin which grant reports are expected this week and which are already late. Pure
// half here, IO half in `src/server/reportsDigest`, split exactly as
// `src/lib/financeDigest` is and for the same reason — an email is only ever seen in
// an inbox, and a renderer you can exercise in a test is the only way to read Monday's
// message on a Tuesday.
//
// Why a SEPARATE email rather than a second section on the payments one:
//
//   • Different audiences. Payments go to finance, reports to admins, and the overlap
//     is usually nobody. A combined email would be half irrelevant to both.
//   • Different off switches. One email means one unsubscribe, and a finance officer
//     turning off payment reminders would silently stop an admin's report chasing.
//   • Different empty states. A week with no payments due and three reports late must
//     still send something. Folded together, the "nothing due sends nothing" rule has
//     to be re-derived per section, and the version of that rule that is wrong sends a
//     mostly-empty email every week until people filter it.

/** One outstanding reporting milestone, as the digest lists it. */
export interface ReportDigestItem {
  awardId: string
  organisationName: string
  programmeName: string | null
  /** The milestone's own name, e.g. "Interim report". Never null on a schedule row. */
  label: string
  /** ISO yyyy-mm-dd. `report_schedule.due_date` is NOT NULL, so always present. */
  dueDate: string
  /** How many days past due, for the overdue list. Zero or less for anything not late. */
  daysLate: number
}

/** Everything the renderer needs. No database types cross this line. */
export interface ReportDigestModel {
  clientName: string
  recipientName: string
  /** Monday of the week covered, ISO yyyy-mm-dd. */
  weekOf: string
  /** Unsubmitted, due before today, however old. Late reports lead. */
  overdue: ReportDigestItem[]
  /** Unsubmitted, due from today through the end of the digest window. */
  dueThisWeek: ReportDigestItem[]
  /** Absolute URL of the Reports screen. */
  reportsUrl: string
  /** Absolute URL that turns this email off without signing in. */
  unsubscribeUrl: string
}

/**
 * Is there anything worth sending?
 *
 * A week with nothing expected sends NOTHING. Identical rule to `digestHasContent`, and
 * it matters more here: reports are lumpier than payments, so a foundation can go two
 * quiet months, and an "all clear" every Monday through those months is what teaches
 * somebody to filter the email before the quarter when four reports land late.
 */
export function reportDigestHasContent(model: ReportDigestModel): boolean {
  return model.overdue.length > 0 || model.dueThisWeek.length > 0
}
