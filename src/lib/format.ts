// ─── Display formatting, shared by every screen ──────────────────────────────
//
// One implementation of the money/date formats the app renders everywhere.
// These were once copied per-route and drifted (some rounded pennies, some
// didn't); if a screen needs a new format, add it here rather than locally.

/** Whole pounds with thousands separators: `£12,345`. */
export function fmtMoney(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

/** As `fmtMoney`, from a numeric column that may arrive as a string: `—` when absent. */
export function fmtAmount(amount: string | number | null | undefined): string {
  if (amount == null || amount === '') return '—'
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  if (isNaN(n)) return '—'
  return fmtMoney(n)
}

/** KPI-sized money: `£1.2m` / `£45k` / `£950`, negatives prefixed with `-`. */
export function fmtCompact(n: number): string {
  const neg = n < 0
  const a = Math.abs(n)
  let s: string
  if (a >= 1_000_000) s = `£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`
  else if (a >= 1_000) s = `£${Math.round(a / 1_000)}k`
  else s = `£${Math.round(a).toLocaleString('en-GB')}`
  return neg ? `-${s}` : s
}

/**
 * Compact age of a timestamp: `now` / `4h` / `2d` / `1w` / `3mo` / `2y`.
 * The form the comment feed uses, where the exact minute never matters and the
 * column is a few characters wide.
 */
export function fmtSince(date: Date | string): string {
  const secs = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000)
  const mins = Math.floor(secs / 60)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (days < 30) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

/** `12 Mar 2026`, or `—` when absent. */
/**
 * The app has TWO kinds of date and they must not be formatted the same way.
 *
 * - **Calendar dates** — `award_instalments.due_date` / `paid_date`,
 *   `report_schedule.due_date` / `submitted_date`, `awards.start_date`: `text` columns
 *   holding `yyyy-mm-dd`. A payment is due "on the 31st"; there is no time and no zone.
 * - **Instants** — every `timestamp` column: `submitted_at`, `decision_at`, `created_at`.
 *   A real moment, stored as UTC by convention (JS writes them with `toISOString()`).
 *
 * `new Date('2026-08-31')` parses as UTC midnight and then renders in the VIEWER's zone,
 * so a payment due on the 31st displayed as **30 Aug** anywhere west of the UK; and an
 * award stamped 23:15 UTC displayed as the **next day** during British Summer Time. Both
 * were live, and invisible from London for half the year.
 *
 * So everything is formatted in UTC, and a calendar date is pinned to UTC midnight
 * first: the digits stored are the digits shown, wherever the reader is sitting. That
 * also makes the screen agree with the CSV exports and with the server's own `to_char`,
 * which all take the UTC day.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `yyyy-mm-dd` string is a calendar date; anything else is an instant. */
function asUtc(date: Date | string): Date {
  return new Date(typeof date === 'string' && ISO_DAY.test(date) ? `${date}T00:00:00Z` : date)
}

/** `5 Mar 2026` — the app's one date format. `—` when there is nothing to show. */
export function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return asUtc(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * `5 March 2026 at 14:32 UTC` — the long form, for the tooltip on a date that HAS a
 * time. Returns null for a calendar date, because there is no time to reveal and
 * inventing "00:00" would be claiming precision the column has not got.
 */
export function fmtDateTime(date: Date | string | null | undefined): string | null {
  if (!date) return null
  if (typeof date === 'string' && ISO_DAY.test(date)) return null
  const d = new Date(date)
  const day = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  return `${day} at ${time} UTC`
}

/** The machine-readable value for `<time dateTime>`: the calendar day, or the instant. */
export function isoValue(date: Date | string): string {
  if (typeof date === 'string' && ISO_DAY.test(date)) return date
  return new Date(date).toISOString()
}
