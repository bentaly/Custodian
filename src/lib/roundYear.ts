import { financialYear, shiftFinancialYear, type FinancialYear } from './financialYear'

/**
 * Which financial year a round's budgets are drawn from.
 *
 * A `round_programmes.budget` counts ONE year's cash (`src/lib/multiYear.ts`), so every
 * round has to belong to exactly one year — otherwise the same allocation is counted in
 * two years' reconciliation and the shortlist meter measures against whichever year
 * happens to be current when somebody looks.
 *
 * ## Derived by default, always correctable
 *
 * **The year a round CLOSES in** is the default, because that is when its decisions are
 * made and when its money is committed. It is right for most rounds and it is what a
 * round that has never been asked about keeps.
 *
 * It is not right for all of them, which is the thing this got wrong until 2026-09-22.
 * The question used to be asked only where a round's own dates straddled a year end, on
 * the reasoning that a round opening and closing inside one year had a single possible
 * answer. A real foundation broke that: theirs takes applications from January, closes
 * on **31 March** — the last day of the year — and pays the grants in **May**, which is
 * the next one. Every date on the round sat inside 2025/26 while every pound left the
 * bank in 2026/27, so the control never appeared, and the one year it would have offered
 * was the wrong one. The round was unfixable rather than merely mis-defaulted.
 *
 * So the question is now asked on every round, phrased as the thing the foundation
 * actually knows: **which year will these grants be paid from**. A round decides and then
 * pays, so the answer is the year it closes in or the year after, never earlier. Where
 * the round straddles a year end the year it OPENS in joins them, because spending the
 * old year's underspend is a real thing a foundation does, and that was the case the
 * control was built for.
 *
 * An undated round falls back to the year containing today. It is the state a
 * half-created round is in, it resolves the moment dates are set, and every alternative
 * (refusing to meter it, showing it in no year) is worse than metering it against now.
 */
export function roundFinancialYear(
  round: {
    financialYearStart: string | null
    openedAt: Date | string | null
    closedAt: Date | string | null
  },
  endMonth: number,
  now: Date = new Date(),
): FinancialYear {
  // A stored answer always wins, and is re-derived through `financialYear` rather than
  // trusted as bounds: the year-end month can change after a round was filed, and the
  // year that start date falls in is still the year they meant.
  if (round.financialYearStart) {
    return financialYear(endMonth, new Date(`${round.financialYearStart}T00:00:00Z`))
  }
  const anchor = round.closedAt ?? round.openedAt
  return financialYear(endMonth, anchor ? new Date(anchor) : now)
}

/** How a year on offer relates to the round's dates, so the control can say it in words. */
export type RoundYearRelation = 'opens' | 'closes' | 'after'

export type RoundYearOption = FinancialYear & {
  isDefault: boolean
  relation: RoundYearRelation
}

/**
 * The years a round's grants could be paid from, in date order, with the default flagged.
 *
 * Always at least two, because "the year it closes in" and "the year after" are both real
 * answers for every round: a foundation deciding in March and paying in May is the case
 * that forced this (see `roundFinancialYear`). A round that straddles a year end gets a
 * third, the year it OPENS in, which is the old-underspend answer.
 *
 * Only ever those three. A round running eighteen months is a data-entry mistake far more
 * often than a real shape, so the years BETWEEN its ends are still never offered.
 */
export function roundYearOptions(
  round: { openedAt: Date | string | null; closedAt: Date | string | null },
  endMonth: number,
  now: Date = new Date(),
): RoundYearOption[] {
  const opened = round.openedAt ? new Date(round.openedAt) : null
  const closed = round.closedAt ? new Date(round.closedAt) : null
  // The same anchor `roundFinancialYear` derives from, so the flagged default and the
  // year an unanswered round is actually metered in can never drift apart.
  const anchor = closed ?? opened ?? now

  const closing = financialYear(endMonth, anchor)
  const opening = opened ? financialYear(endMonth, opened) : null
  const following = shiftFinancialYear(endMonth, 1, anchor)

  const out: RoundYearOption[] = []
  if (opening && opening.start !== closing.start) {
    out.push({ ...opening, isDefault: false, relation: 'opens' })
  }
  out.push({ ...closing, isDefault: true, relation: 'closes' })
  out.push({ ...following, isDefault: false, relation: 'after' })
  return out
}
