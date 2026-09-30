/**
 * Multi-year grants: what a round's budget counts, and what this year's cash is.
 *
 * ## Two figures, kept apart
 *
 * A **commitment** is the whole value of a grant, counted the day the trustees decide
 * it. A £60,000 grant over three years is a £60,000 commitment immediately. That is how
 * charity SORP recognises it and it is what the annual accounts, the Awards register and
 * Insights all report — see CLAUDE.md's money rule, none of which this module changes.
 *
 * **This year's cash** is the part of that grant which has to leave the bank account
 * before the year end: often £20,000, sometimes £36,000, sometimes nothing. A
 * `round_programmes.budget` counts THIS, because a round is allocated out of one year's
 * giving capacity and a round of three-year grants would otherwise be able to commit
 * three times what it was given.
 *
 * Every figure in the chain — the annual new-grants budget, a round's budget, a shortlist's
 * drawdown — is this year's cash. The one exception is the accounts total at the year
 * end, which stays on commitment and is the figure the examiner sees.
 *
 * ## Why the first year is STATED and not derived
 *
 * At shortlist there is no schedule to divide. The start date, the number of instalments
 * and the gaps between them are set later, in award set-up, and until then the ask is a
 * single number with a duration hint beside it. Dividing by the duration is right for
 * the ordinary annual case, which is why it is the suggestion — but a £48,000 grant paid
 * every four months over sixteen months draws £36,000 in its first year against a
 * suggestion of £24,000, a quarter of the grant missing from a budget meter. No formula
 * fixes that, because the schedule genuinely does not exist yet. So the suggestion is
 * offered and the person shortlisting can correct it.
 *
 * **Once the award exists, neither of these is read**: the award's own instalment dates
 * are the answer, and `roundProgrammeSpend` uses them. The stated figure is a stand-in
 * for a schedule that has not been agreed, not a parallel record of one that has.
 */

/**
 * What to suggest as the first year's share of an ask.
 *
 * `years` is `round_programmes.grant_duration_years` — how long awards from this round
 * typically run. Absent, zero or one means the whole ask falls in this year, which is
 * also the right answer for every single-year foundation and is why nothing had to be
 * backfilled.
 *
 * Rounded to whole pounds, and never more than the ask: a duration of 0 or a negative
 * year count (neither reachable through the validator, both reachable over the wire)
 * must not produce a drawdown larger than the grant.
 */
export function suggestFirstYearAmount(amountRequested: number, years: number | null): number {
  if (!Number.isFinite(amountRequested) || amountRequested <= 0) return 0
  if (years === null || !Number.isFinite(years) || years <= 1) return amountRequested
  return Math.min(amountRequested, Math.round(amountRequested / years))
}

/**
 * The first year's share to use: what somebody stated, else the suggestion.
 *
 * NULL `stated` is "nobody has said", not "zero" — the same convention as
 * `users.weekly_finance_digest` and `client_profiles.award_letter_template`. A stated
 * zero is therefore honoured: a foundation may genuinely agree a grant whose first
 * payment falls after this year end, and that draws nothing from this round.
 */
export function resolveFirstYearAmount(app: {
  amountRequested: number
  firstYearAmount: number | null
  grantDurationYears: number | null
}): number {
  if (app.firstYearAmount !== null && Number.isFinite(app.firstYearAmount)) {
    return Math.max(0, Math.min(app.amountRequested, app.firstYearAmount))
  }
  return suggestFirstYearAmount(app.amountRequested, app.grantDurationYears)
}

/**
 * Whether the figure in use is the suggestion rather than something somebody stated.
 *
 * Takes the raw column, which arrives as a string from Postgres `numeric` and as a number
 * once parsed — only its presence matters, and requiring a parse first would mean every
 * caller converting a value purely to ask whether it exists.
 */
export function isSuggestedFirstYear(firstYearAmount: number | string | null): boolean {
  return firstYearAmount === null
}

/** An instalment, as both callers below have it. */
export type InstalmentForYear = {
  /** `yyyy-mm-dd`, or null for a "TBC" instalment with no date to place it by. */
  dueDate: string | null
  /** `yyyy-mm-dd` once paid, else null. Absent reads as unpaid. */
  paidDate?: string | null
  amount: number
  /** Cancelled awards' UNPAID instalments are excluded; kept here so tests can prove it. */
  awardStatus?: string
}

/**
 * This year's cash on grants already decided: paid in the year, or still to pay by its end.
 *
 * **Paid inside the year counts** (cancelled grants included: the money left). The
 * figure is what earlier years' grants draw from this year, added to the NEW-grants
 * budget in Settings' Summary panel (the budget line covers new grants only since
 * 2026-09-30), and it must not shrink as the payment run goes out. It counted unpaid only until
 * 2026-09-30, and read £9,729.50 where Finance's prior-year line read £19,899.50.
 *
 * **No lower bound on an unpaid due date.** An instalment that fell due last March and
 * has not been paid is still money that has to leave the account this year, and
 * excluding it would understate exactly the figure this exists to state.
 *
 * **Undated unpaid instalments count in.** Money with no date is still owed, and
 * dropping it would make a foundation that has not scheduled a grant look like it had
 * nothing to pay. (No path writes one any more.)
 *
 * A cancelled grant's UNPAID instalments are out: there is nothing left to pay.
 * `getAnnualBudgetSettings` is this rule in SQL, grouped by programme.
 */
export function carriedCommitmentForYear(
  instalments: InstalmentForYear[],
  fy: { start: string; end: string },
): number {
  return instalments
    .filter((i) =>
      i.paidDate
        ? i.paidDate >= fy.start && i.paidDate <= fy.end
        : i.awardStatus !== 'cancelled' && (i.dueDate === null || i.dueDate <= fy.end),
    )
    .reduce((sum, i) => sum + (Number.isFinite(i.amount) ? i.amount : 0), 0)
}
