import { financialYear, type FinancialYear } from './financialYear'

/**
 * Which financial year a round's budgets are drawn from.
 *
 * A `round_programmes.budget` counts ONE year's cash (`src/lib/multiYear.ts`), so every
 * round has to belong to exactly one year — otherwise the same allocation is counted in
 * two years' reconciliation and the shortlist meter measures against whichever year
 * happens to be current when somebody looks.
 *
 * ## Derived where there is only one answer, asked where there are two
 *
 * **The year a round CLOSES in** is the default, because that is when its decisions are
 * made and when its money is committed. A round that opens and closes inside one year has
 * only that answer, and asking would be a question with one option.
 *
 * A round that straddles a year end has two real answers and we cannot pick: one opening
 * in February and closing in June may be spending the old year's underspend or the new
 * year's allocation, and only the foundation knows. So `rounds.financial_year_start`
 * stores what they said, NULL means "derive it", and the dialog only asks when
 * `roundYearIsAmbiguous` says the question exists.
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

/**
 * The years a round could belong to — one, or two where it straddles a year end.
 *
 * Two entries is exactly the condition the dialog asks on. Returned in date order, with
 * the default (the closing year) flagged, so the control can present it as the
 * pre-selected option rather than as an empty question.
 */
export function roundYearOptions(
  round: { openedAt: Date | string | null; closedAt: Date | string | null },
  endMonth: number,
  now: Date = new Date(),
): Array<FinancialYear & { isDefault: boolean }> {
  const opened = round.openedAt ? new Date(round.openedAt) : null
  const closed = round.closedAt ? new Date(round.closedAt) : null
  if (!opened || !closed) {
    const only = financialYear(endMonth, closed ?? opened ?? now)
    return [{ ...only, isDefault: true }]
  }
  const from = financialYear(endMonth, opened)
  const to = financialYear(endMonth, closed)
  if (from.start === to.start) return [{ ...from, isDefault: true }]
  // Only the two ENDS are offered, never the years between. A round running eighteen
  // months is a data-entry mistake far more often than a real three-year round, and
  // offering the middle year would dress that up as a supported shape.
  return [
    { ...from, isDefault: false },
    { ...to, isDefault: true },
  ]
}

/** Whether the round straddles a year end, and so has a question to ask. */
export function roundYearIsAmbiguous(
  round: { openedAt: Date | string | null; closedAt: Date | string | null },
  endMonth: number,
  now: Date = new Date(),
): boolean {
  return roundYearOptions(round, endMonth, now).length > 1
}
