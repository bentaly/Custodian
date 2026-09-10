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
 * Every figure in the chain — the annual "free to give", a round's budget, a shortlist's
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
 * offered and the person shortlisting can correct it, the same way the annual carried
 * figure below is offered and can be overridden.
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
  amount: number
  /** Cancelled awards are excluded by the caller's query; kept here so tests can prove it. */
  awardStatus?: string
}

/**
 * Cash owed in a financial year against grants already decided.
 *
 * **There is deliberately no lower bound on the due date.** An instalment that fell due
 * last March and has not been paid is still money that has to leave the account this
 * year, and excluding it would understate exactly the figure this exists to state. The
 * Finance panel's `dueByYearEnd` bucket is bounded the same way for the same reason
 * (`src/server/finance/budget.ts`), and the two must keep agreeing: this is that figure,
 * grouped by programme.
 *
 * **Undated instalments count in.** Money with no date is still owed, and the
 * alternative — dropping it — would make a foundation that has not scheduled a grant
 * look like it had nothing to pay. The Finance panel keeps them in their own `undated`
 * bucket because that screen can afford a third number; this one cannot.
 *
 * Callers pass only UNPAID instalments of NON-CANCELLED awards. Paid money has already
 * left and the bank balance reflects it; a cancelled grant has nothing left to pay.
 */
export function carriedCommitmentForYear(
  instalments: InstalmentForYear[],
  fy: { start: string; end: string },
): number {
  return instalments
    .filter((i) => i.awardStatus !== 'cancelled')
    .filter((i) => i.dueDate === null || i.dueDate <= fy.end)
    .reduce((sum, i) => sum + (Number.isFinite(i.amount) ? i.amount : 0), 0)
}

export type ProgrammeCashLine = {
  programmeId: string
  name: string
  colour: string | null
  /** The year's allocation for this programme, from `annual_budget_lines.amount`. */
  budget: number
  /** Cash owed this year from grants decided before, as derived from instalment dates. */
  promisedDerived: number
  /** What a finance lead stated instead, or null if they accepted the derived figure. */
  promisedStated: number | null
  /** The figure in use: stated if there is one, else derived. */
  promised: number
  /** `budget - promised`, floored at 0 — what is free to give across this year's rounds. */
  free: number
  /** What this year's rounds have allocated out of `free`. */
  allocated: number
  /** `free - allocated`. Negative means the rounds have promised more than is free. */
  unallocated: number
  /** True when `promisedStated` differs from `promisedDerived` — the screen says so. */
  overridden: boolean
}

/**
 * The cash view of a year's budget, per programme.
 *
 * The counterpart of `rollUpBudget` (`src/lib/annualBudget.ts`), which is the commitment
 * view and is unchanged. Both are drawn, side by side, and where they disagree the
 * screen says so rather than reconciling them away — a foundation holding a buffer back,
 * or one that has committed more in total than this year's cash covers, should see
 * exactly that and say whether it is deliberate.
 *
 * Core-costs lines (no `programmeId`) are not included: they have no grants behind them,
 * so there is nothing to carry forward and no round to allocate to. They stay in the
 * commitment view, which is where a foundation budgets them.
 */
export function rollUpCash(
  lines: {
    programmeId: string | null
    amount: number
    carriedCommitment: number | null
  }[],
  programmes: Map<string, { name: string; colour: string | null }>,
  promisedByProgramme: Map<string, number>,
  allocatedByProgramme: Map<string, number>,
): {
  lines: ProgrammeCashLine[]
  budget: number
  promised: number
  free: number
  allocated: number
} {
  const out: ProgrammeCashLine[] = []

  for (const line of lines) {
    if (!line.programmeId) continue
    const meta = programmes.get(line.programmeId)
    const derived = promisedByProgramme.get(line.programmeId) ?? 0
    const stated = line.carriedCommitment
    const promised = stated ?? derived
    const free = Math.max(0, line.amount - promised)
    const allocated = allocatedByProgramme.get(line.programmeId) ?? 0
    out.push({
      programmeId: line.programmeId,
      name: meta?.name ?? 'Programme',
      colour: meta?.colour ?? null,
      budget: line.amount,
      promisedDerived: derived,
      promisedStated: stated,
      promised,
      free,
      allocated,
      unallocated: free - allocated,
      // Compared with a tolerance rather than `!==`: both sides arrive as numerics
      // parsed out of Postgres, and a stated figure that equals the derived one to the
      // penny must not light up a "buffer applied" note.
      overridden: stated !== null && Math.abs(stated - derived) >= 0.005,
    })
  }

  const sum = (pick: (l: ProgrammeCashLine) => number) => out.reduce((s, l) => s + pick(l), 0)
  return {
    lines: out,
    budget: sum((l) => l.budget),
    promised: sum((l) => l.promised),
    free: sum((l) => l.free),
    allocated: sum((l) => l.allocated),
  }
}
