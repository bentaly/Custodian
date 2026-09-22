// ─── Deriving a payment schedule ────────────────────────────────────────────────
//
// Shared by the award set-up flow (which derives a schedule per grant from terms set
// once for the batch) and by the letter renderer's tests. Dates are ISO yyyy-mm-dd.

/** How auto-mode spaces instalment dates from the first payment date. */
export const CADENCES = [
  { key: 'yearly', label: 'Yearly', months: 12 },
  { key: 'biannual', label: '6-monthly', months: 6 },
  { key: 'quarterly', label: 'Quarterly', months: 3 },
  { key: 'monthly', label: 'Monthly', months: 1 },
] as const

export type CadenceKey = (typeof CADENCES)[number]['key']

export function cadenceMonths(key: CadenceKey): number {
  return CADENCES.find((c) => c.key === key)?.months ?? 12
}

/**
 * Add whole months to an ISO date, clamping to the end of the target month.
 *
 * `Date.setMonth` rolls over — 31 Jan + 1 month lands on 3 March — which would put an
 * instalment in the wrong month entirely. A grant starting on the 31st should pay on
 * the 28th/30th, not slip past the month it belongs to.
 */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

export type ScheduleRow = { amount: number; date: string | null }

/**
 * Split a total into `n` instalments spaced by `months`, with the rounding remainder
 * folded into the FINAL instalment so the schedule always sums to the award exactly —
 * a grantee is never short-changed by a rounding error, and the letter's total always
 * matches the payments listed beneath it.
 */
export function buildSchedule(
  total: number,
  n: number,
  firstDate: string | null,
  months: number,
): ScheduleRow[] {
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => ({
    amount: i === n - 1 ? total - base * (n - 1) : base,
    date: firstDate ? addMonthsIso(firstDate, months * i) : null,
  }))
}

/**
 * The term a payment plan implies, in months: the number of instalments times the gap
 * between them.
 *
 * Counts what the instalments COVER rather than measuring the first date to the last.
 * An annual instalment pays for the year ahead of it, so two payments twelve months
 * apart are a two-year grant even though only twelve months separate the dates.
 * Measuring the dates reports every multi-year grant a year short, which is the trap
 * this function exists to avoid.
 *
 * A hand-edited split has no shared cadence to count, so it has no answer here.
 */
export function scheduleTermMonths(instalments: number, months: number): number {
  return instalments * months
}

/** A term as a whole number of years where the months divide, else as months. */
export function termLabel(months: number): string {
  if (months % 12 !== 0) return `${months} months`
  const years = months / 12
  return years === 1 ? '1 year' : `${years} years`
}
