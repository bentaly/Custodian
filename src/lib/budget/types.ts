// ─── Budget breakdown ────────────────────────────────────────────────────────
//
// An application's project budget, as line items. Stored on
// `applications.budgetBreakdown` (jsonb, nullable — not every foundation
// collects one).
//
// NB: this is the budget for the PROJECT, not a decomposition of the ask. The
// lines need not sum to `amountRequested` — an applicant may be asking this
// funder for part of a larger budget, with the rest matched or secured
// elsewhere. Do not reconcile the two, and do not derive one from the other.

export interface BudgetLine {
  /** What the money is for, in the applicant's own words (e.g. "Staff costs"). */
  item: string
  /** The figure for this line, in pounds (GBP), to the penny — decimals allowed. */
  amount: number
  /**
   * Any further fields the foundation captured against this line beyond item and
   * amount (e.g. a description column, a cost type, a supplier). We don't
   * interpret these — only `item` and `amount` drive the breakdown UI and
   * scoring — but we keep them so nothing the applicant entered is lost, and show
   * them on the application detail view. Absent when the line had no extra fields.
   *
   * The common Item / Description / Cost form (see the7stars' Social Impact form)
   * lands here as one detail — `{ label: "Description", value: … }`.
   */
  details?: Array<{ label: string; value: string }>
}
