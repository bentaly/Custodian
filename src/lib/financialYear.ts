/**
 * A foundation's financial year, derived from the one thing they actually know about it.
 *
 * Grant-makers do not think in "year start" — they think in **year end**, because that
 * is the date on the front of their signed accounts and the date the Charity Commission
 * asks for ("accounting reference date, 31 March"). So `client_profiles` stores the END
 * month and everything here derives from it. Storing a start month instead would mean
 * every admin mentally subtracts one before typing, which is exactly the sort of
 * off-by-one that goes unnoticed for a year and then misfiles a whole year's giving.
 *
 * Only the MONTH is stored, not a full date. UK charity year ends land on month ends
 * essentially always, and a month is a value an admin can pick from a list of twelve
 * without a date picker or a leap-year conversation. A foundation with a genuinely
 * irregular year end (the retail "Saturday nearest 31 December" shape) is not
 * representable, and that is a deliberate trade rather than an oversight — widening
 * this to a full date later is additive.
 *
 * The default is **3 (31 March)**, the commonest charity year end in the UK, so a
 * foundation that never opens the setting still gets a year that matches its accounts.
 */

/** 1 = January … 12 = December. The month the financial year ENDS in. */
export const DEFAULT_FY_END_MONTH = 3

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export type FinancialYear = {
  /** Inclusive `yyyy-mm-dd` first day of the year. */
  start: string
  /** Inclusive `yyyy-mm-dd` last day of the year. */
  end: string
  /** "2026/27" for a straddling year, "2026" for one that ends in December. */
  label: string
}

/** The last day of a month, as a day number. Handles February in a leap year. */
function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isFyEndMonth(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 12
}

/**
 * The financial year containing `on`.
 *
 * A year ending in December is the calendar year and is labelled as one — writing
 * "2026/27" for 1 Jan–31 Dec 2026 would be actively wrong, and a good few foundations
 * (family offices especially) run calendar years.
 *
 * Everything is computed in UTC. These are accounting boundaries, not moments: a grant
 * awarded at 23:30 on 31 March in London must not fall into the next financial year
 * because the server happened to be an hour ahead.
 */
export function financialYear(endMonth: number, on: Date = new Date()): FinancialYear {
  const m = isFyEndMonth(endMonth) ? endMonth : DEFAULT_FY_END_MONTH
  const y = on.getUTCFullYear()
  const month = on.getUTCMonth() + 1

  // The year the current FY ends in: this calendar year if we have not passed the end
  // month yet, otherwise the next one.
  const endYear = month <= m ? y : y + 1
  const startYear = m === 12 ? endYear : endYear - 1
  const startMonth = m === 12 ? 1 : m + 1

  return {
    start: iso(startYear, startMonth, 1),
    end: iso(endYear, m, lastDayOf(endYear, m)),
    label: m === 12 ? String(endYear) : `${startYear}/${String(endYear).slice(2)}`,
  }
}

/** The financial year `n` years before (negative) or after (positive) the one containing `on`. */
export function shiftFinancialYear(
  endMonth: number,
  offset: number,
  on: Date = new Date(),
): FinancialYear {
  const current = financialYear(endMonth, on)
  const [y, mm, dd] = current.start.split('-').map(Number)
  return financialYear(endMonth, new Date(Date.UTC(y! + offset, mm! - 1, dd!)))
}

/** "1 April 2026 – 31 March 2027", for the settings page's confirmation line. */
export function financialYearRange(fy: FinancialYear): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return `${day} ${MONTH_NAMES[m! - 1]} ${y}`
  }
  return `${fmt(fy.start)} – ${fmt(fy.end)}`
}
