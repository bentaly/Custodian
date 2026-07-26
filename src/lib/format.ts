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

/** `12 Mar 2026`, or `—` when absent. */
export function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
