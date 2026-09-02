// ─── Display formatting, shared by every screen ──────────────────────────────
//
// One implementation of the money/date formats the app renders everywhere.
// These were once copied per-route and drifted (some rounded pennies, some
// didn't); if a screen needs a new format, add it here rather than locally.

/**
 * Whole pounds with thousands separators: `£12,345`, and `-£500` for a negative.
 *
 * The minus goes OUTSIDE the sign, which is where `fmtCompact` has always put it —
 * templating the number straight in gave `£-500`, so the same figure was punctuated two
 * ways depending on which formatter a screen reached for.
 */
export function fmtMoney(n: number): string {
  const r = Math.round(n)
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`
}

/** As `fmtMoney`, from a numeric column that may arrive as a string: `—` when absent. */
export function fmtAmount(amount: string | number | null | undefined): string {
  if (amount == null || amount === '') return '—'
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  if (isNaN(n)) return '—'
  return fmtMoney(n)
}

/**
 * One band of `fmtCompact`: two significant figures, with a trailing `.0` dropped so a
 * round £5,000 reads `5` and not `5.0`.
 */
function twoSigFigs(v: number): string {
  return v.toFixed(v >= 10 ? 0 : 1).replace(/\.0$/, '')
}

/**
 * The compact string AND the number it actually says, which is what lets a caller tell
 * an abbreviation (`£5k` for £5,000 — exact, just shorter) from a rounding (`£4.8k` for
 * £4,840 — £40 short). Only the second needs the exact figure putting somewhere.
 */
function compactParts(n: number): { text: string; shown: number } {
  const neg = n < 0
  const a = Math.abs(n)
  let text: string
  let shown: number
  // The millions band opens at 999,500, not 1,000,000: above that the thousands band
  // rounds to `1000` and prints the unreal `£1000k`.
  if (a >= 999_500) {
    const s = twoSigFigs(a / 1_000_000)
    text = `£${s}m`
    shown = Number(s) * 1_000_000
  } else if (a >= 1_000) {
    const s = twoSigFigs(a / 1_000)
    text = `£${s}k`
    shown = Number(s) * 1_000
  } else {
    shown = Math.round(a)
    text = `£${shown.toLocaleString('en-GB')}`
  }
  return { text: neg ? `-${text}` : text, shown: neg ? -shown : shown }
}

/**
 * KPI-sized money: `£1.2m` / `£4.8k` / `£45k` / `£950`, negatives prefixed with `-`.
 *
 * **Two significant figures, always.** The thousands band used to round to whole
 * thousands at every size, so a £4,840 ask headlined as **£5k** directly above its own
 * subtext — "£2,420 per year for 2 years", arithmetic that visibly did not add up, and
 * an overstatement of what a charity had actually asked for. The millions band already
 * kept a decimal below 10m for exactly this reason; the thousands band did not match it.
 *
 * Rounding stays to NEAREST rather than down. This formats money in both directions —
 * paid as well as committed — so a form that always understated would be as wrong as one
 * that always overstated; what it no longer does is round a whole significant digit away.
 * Two figures still cannot carry £4,840, so what is left of the rounding is handed over
 * on hover by `CompactMoney` — see `compactExact`.
 *
 * A figure a reader has to RECONCILE (an award amount, an instalment, a total that must
 * agree with the foundation's own ledger) wants `fmtMoney`, which is exact.
 */
export function fmtCompact(n: number): string {
  return compactParts(n).text
}

/**
 * The exact figure behind a compact one — `£4,840` for `£4.8k` — or `null` when the
 * compact form rounded nothing away and repeating it would say nothing.
 *
 * That `null` is the point. A tooltip on `£5k` that opens to read "£5,000" is noise, and
 * worse, it makes the ones that DO carry a different number indistinguishable from it.
 * Same rule as `TruncatedText`, which only wires a tooltip when the text is really cut.
 */
export function compactExact(n: number): string | null {
  return Math.round(n) === compactParts(n).shown ? null : fmtMoney(n)
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

/**
 * The foundation's OWN reference for an application, as a line of subtext: `Ref A-1234`.
 *
 * Prefixed rather than bare because it is always read among other facts — a programme, a
 * region, a round — and an unlabelled code in that company reads as one more of them.
 * The word matches the one search already uses when it matches on the ref. `null` for a
 * submission that carried no reference, so callers can drop it from a `·`-joined line
 * rather than printing an empty label.
 */
export function fmtRef(ref: string | null | undefined): string | null {
  return ref ? `Ref ${ref}` : null
}

/**
 * How long a grant runs, from `round_programmes.grant_duration_years`: `Single year`,
 * `2 years`, `3 years`. `null` when the round-programme never set one, so a caller can
 * print its own "not set".
 *
 * It was three different strings on four screens — `Over 36 months` on the award queue
 * and in the wizard, `12 months` on the application, `3 years` on the grant — so the
 * same grant's length was quoted in two units depending on where you read it, and 36
 * months is arithmetic a reader should not have to do to learn a grant runs for three.
 * Years, always, because years are the unit the duration is STORED and decided in.
 *
 * One year is `Single year` rather than `1 year`: in a column of `2 years` / `3 years`
 * the eye is scanning for multi-year commitments, and the point of that row is that it
 * is not one. It says nothing about instalments — a single-year grant may still be paid
 * in three — so it deliberately avoids the word "payment".
 */
export function fmtDuration(years: number | null | undefined): string | null {
  if (!years || years <= 0) return null
  return years === 1 ? 'Single year' : `${years} years`
}

/**
 * Money that has to divide exactly: whole pounds when the figure is whole (`£12,000`),
 * pennies when it is not (`£11,666.66`).
 *
 * Not the app's default money format — `fmtMoney` is, and stays whole-pound, because
 * every figure a foundation reconciles is a stated amount rather than a derived one.
 * This is for the few places that show the RESULT of a division, where the pennies are
 * the difference between arithmetic that checks out and arithmetic that does not.
 */
function fmtExact(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return `${n < 0 ? '-' : ''}£${Math.abs(n).toLocaleString('en-GB', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

/**
 * What a multi-year ask works out at per year: `£11,666.66 per year for 3 years`.
 *
 * A total and a duration side by side ("£35k" over "3 years") does not say which it
 * is — £35k a year for three years is a grant three times the size, and the card gave
 * a reader no way to tell. Naming the annual figure settles it in the same breath.
 *
 * **Pennies, and rounded DOWN.** £35,000 over three years is £11,666.66r, which the
 * whole-pound form printed as `£11,667` — three of those is £35,001, a figure larger
 * than the ask sitting directly above it. This card's whole job is to stop a reader
 * mistaking the size of the ask, so it must not overstate it: the annual figure is
 * floored to the penny, so multiplying back out can only ever land on or under the
 * total. (`buildSchedule` splits an award the same way, flooring every instalment and
 * folding the remainder into the last.) A division that comes out whole still reads
 * `£12,000` — no `.00` on a figure with no pennies in it.
 *
 * `null` for a single-year or unset duration, where there is nothing to disambiguate:
 * the caller falls back to `fmtDuration`.
 *
 * Deliberately NOT used for an AWARD. An award has a real instalment schedule, which
 * `buildSchedule` may split unevenly, so an even division would be a figure nobody
 * agreed to. An application carries no schedule yet — the split is arithmetic on the
 * one number the applicant gave, and reads as such.
 */
export function fmtPerYear(amount: number, years: number | null | undefined): string | null {
  if (!years || years <= 1) return null
  if (!isFinite(amount) || amount <= 0) return null
  // The epsilon keeps a division that IS exact off the floor below it: 3000/3 can land
  // on 999.9999999999999 in binary floating point, which would print as £999.99.
  const each = Math.floor((amount / years) * 100 + 1e-6) / 100
  return `${fmtExact(each)} per year for ${years} years`
}
