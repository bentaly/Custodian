/**
 * `applications.amount_requested` as a number, for code that only ever reads
 * SHORTLISTED or AWARDED applications: the shortlist, award set-up, the grant screen,
 * the dashboard's shortlist card.
 *
 * The column is nullable, because a submission that did not state an amount still
 * lands so a person can fill it in. But such an application can be neither assessed
 * nor shortlisted until they do (`updateApplicationStatus` refuses it), so on those
 * paths the null is unreachable and the 0 is never shown. Anything that can see an
 * application still `for_review` must handle null itself and say so on screen, never
 * go through here: a missing amount read as £0 is exactly the lost field this whole
 * change exists to make visible.
 */
export function decidedAmount(value: string | null): number {
  return value == null ? 0 : parseFloat(value)
}

/**
 * The amount an application would be AWARDED at: what the foundation proposed
 * (`applications.amount_amended`) if anyone did, else what was asked for.
 *
 * Read by everything that counts shortlisted money as money about to be committed: the
 * shortlist meter and the budget ceiling (`roundProgrammeSpend`), the vote card's
 * headline, the award wizard's pre-fill. Anything labelled an "ask" stays on
 * `decidedAmount`, which keeps meaning the amount requested. Null only where the ask
 * itself is missing, which also keeps the proposal out of reach: one cannot be set
 * against nothing (`setAmendedAmount`).
 */
export function effectiveAmount(app: {
  amountRequested: string | number | null
  amountAmended: string | number | null
}): number | null {
  const num = (v: string | number) => (typeof v === 'number' ? v : parseFloat(v))
  if (app.amountRequested === null) return null
  if (app.amountAmended !== null) return num(app.amountAmended)
  return num(app.amountRequested)
}

/**
 * Whether a proposal is on record that differs from the ask, to the half-penny. A figure
 * typed back to exactly the ask is stored as NULL anyway, so this is mainly the guard
 * every screen uses before it prints a "Requested £X" line beside the figure.
 */
export function isAmended(app: {
  amountRequested: string | number | null
  amountAmended: string | number | null
}): boolean {
  if (app.amountRequested === null || app.amountAmended === null) return false
  const eff = effectiveAmount(app)!
  return Math.abs(eff - decidedAmount(String(app.amountRequested))) >= 0.005
}
