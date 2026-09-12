import { CORE_COSTS_LABEL } from './annualBudget'
import { addDaysIso, endOfMonthIso } from './schedule'

/**
 * Core costs through the year — when a non-grant budget line's money actually leaves.
 *
 * A programme line's cash is derived from the instalment dates of real grants. A
 * non-grant line (rent, staff, a legal fee) has nothing behind it but the figure the
 * foundation typed, so the only honest way to place it in time is to ask how it is paid:
 * **monthly** or **one-off**. That one answer is what lets Finance show cash flow across
 * the year instead of a single annual lump.
 *
 * ## `amount` is always the year
 *
 * A monthly line stores its annual figure, not its monthly one. Every total, the Settings
 * check and the Finance meters read `annual_budget_lines.amount` the same way for every
 * line, so frequency changes WHEN the money falls and never HOW MUCH. The Settings screen
 * lets a monthly line be typed per month (that is the figure a finance lead knows) and
 * stores it times the number of months.
 *
 * ## A month's share falls at the month END
 *
 * This is a plan, not a ledger. Custodian never sees the rent go out, so "spent to date"
 * is what the schedule says should have gone. Placing a month's share on its last day is
 * the conservative choice: it keeps the current month in "still to come", so the headroom
 * on Finance can understate spare cash by a month of rent paid in advance but can never
 * overstate it. Overstating is the failure that costs a foundation money.
 *
 * Shares are split to the penny with the remainder on the final month, the same rule
 * `buildSchedule` uses for instalments, so twelve shares always sum to the year.
 */

export type CostFrequency = 'monthly' | 'one_off'

export const COST_FREQUENCIES: { value: CostFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'one_off', label: 'One-off' },
]

/**
 * Names offered in the Settings label field. Suggestions, not categories: the label stays
 * free text, because a foundation's own chart of accounts is the vocabulary that matters
 * and a fixed list would either be too short for one or too long for another.
 */
export const COST_LABEL_SUGGESTIONS = [
  CORE_COSTS_LABEL,
  'Staff',
  'Premises',
  'Governance',
  'Professional fees',
  'Misc.',
] as const

/** NULL, or anything unrecognised, is monthly. See the column comment in the schema. */
export function resolveFrequency(f: string | null | undefined): CostFrequency {
  return f === 'one_off' ? 'one_off' : 'monthly'
}

export type YearMonth = {
  /** `yyyy-mm` */
  key: string
  /** Inclusive bounds, clipped to the year. */
  start: string
  end: string
}

/** The calendar months a financial year spans, in order. Twelve for every real year. */
export function monthsOfYear(fy: { start: string; end: string }): YearMonth[] {
  const out: YearMonth[] = []
  let cursor = `${fy.start.slice(0, 7)}-01`
  while (cursor <= fy.end) {
    const monthEnd = endOfMonthIso(cursor)
    out.push({
      key: cursor.slice(0, 7),
      start: cursor < fy.start ? fy.start : cursor,
      end: monthEnd > fy.end ? fy.end : monthEnd,
    })
    cursor = addDaysIso(monthEnd, 1)
  }
  return out
}

export type CostLineInput = {
  label: string | null
  /** The year's figure. */
  amount: number
  frequency: string | null
  dueDate: string | null
}

export type CostEntry = { date: string; amount: number }

/** The dated amounts one line breaks into across the year. */
export function costEntries(line: CostLineInput, fy: { start: string; end: string }): CostEntry[] {
  const pence = Math.round(line.amount * 100)
  if (!(pence > 0)) return []

  if (resolveFrequency(line.frequency) === 'one_off') {
    // A one-off always has a date (the save refuses one without), but a year-end setting
    // changed after saving can leave it outside the year's bounds. Clamped rather than
    // dropped: the money is still in this year's budget. A missing date falls on the
    // year end, the latest it could be, for the same reason shares fall at month end.
    const d = line.dueDate ?? fy.end
    return [{ date: d < fy.start ? fy.start : d > fy.end ? fy.end : d, amount: pence / 100 }]
  }

  const months = monthsOfYear(fy)
  const each = Math.floor(pence / months.length)
  return months.map((m, i) => ({
    date: m.end,
    amount: (i === months.length - 1 ? pence - each * (months.length - 1) : each) / 100,
  }))
}

export type CoreCostLine = {
  name: string
  frequency: CostFrequency
  /** The year's figure. */
  amount: number
  /** Monthly lines only. */
  perMonth: number | null
  /** One-off lines only. */
  dueDate: string | null
  /** Scheduled on or before `on` — what the plan says has gone, not a record that it did. */
  toDate: number
  toCome: number
}

export type CoreCostRollup = {
  lines: CoreCostLine[]
  total: number
  toDate: number
  toCome: number
  /** Sum of the monthly lines' monthly shares. */
  perMonth: number
  /** Sum of the one-off lines. */
  oneOff: number
}

/** Every non-grant line, scheduled, and where the year stands on `on`. */
export function scheduleCoreCosts(
  lines: CostLineInput[],
  fy: { start: string; end: string },
  on: string,
): CoreCostRollup {
  const monthCount = monthsOfYear(fy).length || 12
  const out: CoreCostLine[] = lines.map((line) => {
    const frequency = resolveFrequency(line.frequency)
    const entries = costEntries(line, fy)
    const toDate = entries.filter((e) => e.date <= on).reduce((s, e) => s + e.amount, 0)
    return {
      name: line.label?.trim() || CORE_COSTS_LABEL,
      frequency,
      amount: line.amount,
      perMonth: frequency === 'monthly' ? line.amount / monthCount : null,
      dueDate: frequency === 'one_off' ? (entries[0]?.date ?? line.dueDate) : null,
      toDate: round2(toDate),
      toCome: round2(line.amount - toDate),
    }
  })
  const sum = (pick: (l: CoreCostLine) => number) => round2(out.reduce((s, l) => s + pick(l), 0))
  return {
    lines: out,
    total: sum((l) => l.amount),
    toDate: sum((l) => l.toDate),
    toCome: sum((l) => l.toCome),
    perMonth: sum((l) => l.perMonth ?? 0),
    oneOff: sum((l) => (l.frequency === 'one_off' ? l.amount : 0)),
  }
}

/** Pennies, so float noise from summing shares never reaches a £ figure or a comparison. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** A budget line as a save receives it, before anything is stored. */
export type SavedLineTiming = {
  programmeId: string | null
  label: string | null
  amount: number
  frequency?: string | null
  dueDate?: string | null
}

/**
 * What a save stores for a line's timing.
 *
 * A programme line stores none — its cash comes from its grants' instalments. A cost line
 * always stores a frequency, never NULL, so "never chosen" and "monthly" cannot drift
 * apart on new rows; and a date only when it is one-off, so a date left behind by a line
 * switched to monthly is dropped rather than kept to mislead whoever reads the row next.
 */
export function storedTiming(line: SavedLineTiming): {
  frequency: CostFrequency | null
  dueDate: string | null
} {
  if (line.programmeId) return { frequency: null, dueDate: null }
  const frequency = resolveFrequency(line.frequency)
  return { frequency, dueDate: frequency === 'one_off' ? line.dueDate || null : null }
}

/**
 * Why these lines cannot be saved, or null.
 *
 * The single statement of the rule, used by the Settings screen to disable Save and by
 * `saveAnnualBudget` to refuse, so the button and the boundary cannot disagree. Only a
 * one-off cost WITH an amount is checked — it needs a date, inside the year. A zero line
 * is not saved at all, so its date is nobody's business.
 */
export function costTimingProblem(
  lines: SavedLineTiming[],
  fy: { start: string; end: string },
): string | null {
  for (const l of lines) {
    if (l.programmeId || !(l.amount > 0)) continue
    const { frequency, dueDate } = storedTiming(l)
    if (frequency !== 'one_off') continue
    const name = l.label?.trim() || 'The one-off cost'
    if (!dueDate) return `${name} needs a date.`
    if (dueDate < fy.start || dueDate > fy.end) {
      return `${name} is dated outside this financial year.`
    }
  }
  return null
}

/**
 * A saved cost line's amount as the Settings form shows it: per month for a monthly
 * line, as stored for a one-off.
 *
 * A monthly line also hands back the stored year as `loadedAnnual`. A year shown per
 * month is rounded to the penny (£50,000 is £4,166.67), and twelve of those is
 * £50,000.04 — so until somebody edits the field, the stored year is what gets saved.
 */
export function formAmount(
  annual: number,
  frequency: CostFrequency,
  months: number,
): { typed: string; loadedAnnual: number | null } {
  if (frequency !== 'monthly') return { typed: String(annual), loadedAnnual: null }
  return { typed: String(round2(annual / months)), loadedAnnual: annual }
}

/** The year's figure from what a cost line's form fields hold. Blank or negative is 0. */
export function annualFromForm(
  typed: string,
  frequency: CostFrequency,
  months: number,
  loadedAnnual: number | null,
): number {
  const n = parseFloat(typed)
  const figure = Number.isFinite(n) && n > 0 ? n : 0
  if (frequency !== 'monthly') return figure
  return loadedAnnual ?? round2(figure * months)
}
