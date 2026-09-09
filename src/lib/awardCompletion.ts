// ─── When a grant is finished ────────────────────────────────────────────────
//
// A grant is COMPLETE when nobody has anything left to do with it: the money is all
// out of the door, everything the foundation asked for has come back, and a person has
// read what came back. Anything short of that is `active`. `cancelled` is a decision,
// not a derivation, and is never reached or left by this module.
//
// This used to mean "every instalment is paid", derived in one place as a side effect
// of ticking off a payment. Reporting played no part, so a grant went Complete the day
// the final payment cleared — often a year before the last report was due. Worse, the
// two halves of the app then contradicted each other on screen: the outstanding-report
// queries (`server/reports/query.ts`, `fns/dashboard.ts`) key on the milestone alone
// and never look at the award, so the dashboard listed a report overdue against a grant
// the Awards screen was badging as finished. Both were right about their own fact.
//
// The rule lives here, pure, because it is now derived from three tables and written
// from six call sites (`server/awards/status.ts`), and a rule spread across six
// handlers is a rule that drifts.

/** Just enough of an `award_instalments` row to know whether the money went. */
export type CompletionInstalment = { paidDate: string | null }

/** Just enough of a `report_schedule` row to know whether the report came back. */
export type CompletionMilestone = { submittedDate: string | null }

/** Just enough of a `reports` row to know whether it is ours to read, and whether we have. */
export type CompletionReport = {
  reviewedAt: Date | string | null
  scheduleId: string | null
  importBatchId: string | null
}

export type CompletionInputs = {
  instalments: CompletionInstalment[]
  milestones: CompletionMilestone[]
  reports: CompletionReport[]
}

/**
 * Whether a `reports` row is a report that ARRIVED, as opposed to a figure the
 * onboarding import parked there.
 *
 * The TS twin of `isArrivedReport()` in `server/reports/query.ts`, which states the same
 * test in SQL for the Reports library. Keep the two in step: an imported impact figure
 * answering no milestone is not a document anyone submitted, so requiring somebody to
 * review it would hold every imported grant open forever over a number typed into a
 * spreadsheet in 2019.
 */
export function isArrivedReport(r: CompletionReport): boolean {
  return r.importBatchId === null || r.scheduleId !== null
}

/**
 * The four conditions, in the order a person would check them.
 *
 * Note the asymmetry between the two empty cases, which is deliberate. **No instalments
 * at all is not complete** — a grant with no payment schedule has not paid anything, and
 * treating an empty schedule as "all paid" would complete a grant the moment it was
 * minted. **No milestones at all IS complete** on payment, because that is a state a
 * foundation sets on purpose and the award screen says so in as many words: "nothing is
 * expected back from this grantee".
 *
 * Condition four is "of the reports we actually hold, none is still unread" — not "every
 * milestone has a reviewed report behind it". A milestone can be ticked with no document
 * to review (the onboarding import writes `submitted_date` directly), and a report can
 * arrive answering no milestone at all. Reading it the other way would strand every
 * imported grant at `active` permanently.
 */
export function awardIsComplete({ instalments, milestones, reports }: CompletionInputs): boolean {
  if (instalments.length === 0) return false
  if (instalments.some((i) => !i.paidDate)) return false
  if (milestones.some((m) => !m.submittedDate)) return false
  return !reports.some((r) => isArrivedReport(r) && !r.reviewedAt)
}

/**
 * The status an award should be at, given what is on its child rows.
 *
 * Takes the current status only to protect `cancelled`: a withdrawn grant keeps its
 * instalments and milestones, so re-deriving it from them would quietly resurrect it.
 */
export function deriveAwardStatus(
  current: 'active' | 'completed' | 'cancelled',
  inputs: CompletionInputs,
): 'active' | 'completed' | 'cancelled' {
  if (current === 'cancelled') return 'cancelled'
  return awardIsComplete(inputs) ? 'completed' : 'active'
}
