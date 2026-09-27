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
