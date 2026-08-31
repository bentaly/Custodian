/**
 * Turning a year's budget and a year's awards into the meters the Finance panel draws.
 *
 * Pure half of the feature — `src/server/finance/budget.ts` fetches, this reconciles.
 * It is separated because the two rules below are the ones most worth pinning in a test
 * and least worth re-deriving by reading SQL.
 *
 * ## Rule 1 — `used = max(committed, paid)`
 *
 * CLAUDE.md's money rule says **paid** includes cancelled grants (the money left the
 * building) while **committed** excludes them (nothing left to pay). Nothing had to
 * reconcile the two until this panel put them in one bar, where a grant cancelled after
 * a part-payment makes `committed - paid` negative and the meter draws backwards.
 *
 * `used` is what the year's allocation no longer has, whichever way the money left. With
 * no cancellations `committed >= paid` and it is simply `committed`, which is why the
 * arithmetic on screen still reconciles against Finance's own totals.
 *
 * ## Rule 2 — spend with no budget line is a line, not a rounding error
 *
 * A programme that awarded £24,000 against no allocation is £24,000 over budget. Folding
 * it silently into the total would make the meters sum to less than the money that
 * actually went out, and the one number a foundation would check first — "do the bars add
 * up to the total?" — would be wrong for a reason nothing on screen explained.
 */

export type BudgetLineInput = {
  /** NULL for a non-grant line (core costs). */
  programmeId: string | null
  /** Only used for a non-grant line; a programme line takes the programme's name. */
  label: string | null
  amount: number
}

export type ProgrammeActual = {
  programmeId: string
  name: string
  colour: string | null
  /** Awarded in the year, cancelled EXCLUDED. */
  committed: number
  /** Paid on awards decided in the year, cancelled INCLUDED. */
  paid: number
}

export type BudgetLine = {
  programmeId: string | null
  name: string
  colour: string | null
  /** 0 for a programme with spend but no allocation. */
  budget: number
  committed: number
  paid: number
  /** `max(committed, paid)` — see Rule 1. */
  used: number
  /** Negative means overspent; the screen colours on the sign. */
  remaining: number
}

export type BudgetRollup = {
  lines: BudgetLine[]
  total: number
  committed: number
  paid: number
  used: number
  /** Floored at 0 — an overspend is reported per line, not as a negative headline. */
  remaining: number
}

/** The label a non-grant line falls back to when none was stored. */
export const CORE_COSTS_LABEL = 'Core costs'

function lineOf(
  base: Omit<BudgetLine, 'used' | 'remaining'> & { committed: number; paid: number },
): BudgetLine {
  const used = Math.max(base.committed, base.paid)
  return { ...base, used, remaining: base.budget - used }
}

/**
 * Reconcile a year's budget lines against what was actually awarded.
 *
 * Budget lines come first, in the order given (the settings screen's order, which is the
 * foundation's own). Programmes with spend and no line are appended after them, so an
 * unbudgeted programme reads as the exception it is rather than being interleaved into
 * the plan.
 */
export function rollUpBudget(
  budgetLines: BudgetLineInput[],
  actuals: ProgrammeActual[],
  programmeNames: Map<string, { name: string; colour: string | null }> = new Map(),
): BudgetRollup {
  const unclaimed = new Map(actuals.map((a) => [a.programmeId, a]))
  const lines: BudgetLine[] = []

  for (const input of budgetLines) {
    const actual = input.programmeId ? unclaimed.get(input.programmeId) : undefined
    const named = input.programmeId ? programmeNames.get(input.programmeId) : undefined
    lines.push(
      lineOf({
        programmeId: input.programmeId,
        // A programme line is named by its programme, so renaming the programme renames
        // the budget line; only a non-grant line carries its own label.
        name: actual?.name ?? named?.name ?? input.label?.trim() ?? CORE_COSTS_LABEL,
        colour: actual?.colour ?? named?.colour ?? null,
        budget: input.amount,
        committed: actual?.committed ?? 0,
        paid: actual?.paid ?? 0,
      }),
    )
    if (input.programmeId) unclaimed.delete(input.programmeId)
  }

  for (const actual of unclaimed.values()) {
    if (actual.committed === 0 && actual.paid === 0) continue
    lines.push(
      lineOf({
        programmeId: actual.programmeId,
        name: actual.name,
        colour: actual.colour,
        budget: 0,
        committed: actual.committed,
        paid: actual.paid,
      }),
    )
  }

  const sum = (pick: (l: BudgetLine) => number) => lines.reduce((s, l) => s + pick(l), 0)
  const total = sum((l) => l.budget)
  const used = sum((l) => l.used)

  return {
    lines,
    total,
    committed: sum((l) => l.committed),
    paid: sum((l) => l.paid),
    used,
    remaining: Math.max(0, total - used),
  }
}

export type OutstandingSplit = {
  /** Committed − paid on live grants. Agrees with Finance's `outstanding` KPI by construction. */
  total: number
  /** Unpaid instalments dated on or before the year end, overdue ones included. */
  dueByYearEnd: number
  dueLater: number
  /** Unpaid instalments with no date ("TBC") — owed, but not chaseable on a date. */
  undated: number
  /** Committed money no instalment covers. What Finance's Attention banner calls unscheduled. */
  unscheduled: number
}

/**
 * Split what is still owed by when it falls due.
 *
 * This is the whole reason the panel does not set a bank balance against total
 * outstanding: years two and three of a multi-year grant are not paid out of today's
 * cash, and a foundation running healthy three-year grants would otherwise be shown a
 * frightening headroom figure and either stop trusting the screen or, worse, trust it
 * and under-grant.
 *
 * `unscheduled` is DERIVED rather than queried, so the parts always sum to the total a
 * reader can check against the Finance KPI — the alternative is two independent numbers
 * that drift the first time an instalment is edited.
 */
export function splitOutstanding(
  total: number,
  buckets: { dueByYearEnd: number; dueLater: number; undated: number },
): OutstandingSplit {
  const scheduled = buckets.dueByYearEnd + buckets.dueLater + buckets.undated
  return {
    total: Math.max(0, total),
    ...buckets,
    // Clamped: `buildSchedule` guarantees a split sums to its award, but an instalment
    // edited upward by hand can overshoot, and a negative "unscheduled" is not a thing.
    unscheduled: Math.max(0, Math.max(0, total) - scheduled),
  }
}

/**
 * Cash left after everything falling due inside this financial year is paid.
 *
 * Deliberately NOT balance − total outstanding. See `splitOutstanding`.
 */
export function headroom(balance: number, outstanding: OutstandingSplit): number {
  return balance - outstanding.dueByYearEnd
}
