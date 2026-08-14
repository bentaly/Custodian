// ─── Due-date status, shared across screens ──────────────────────────────────
//
// One rule everywhere: due dates are plain `yyyy-mm-dd` strings and compare as
// strings against today (UTC). A milestone due TODAY is still "due soon" — it
// only becomes overdue once midnight has passed. (Timestamp comparison would
// flip it to overdue partway through the day, and did — inconsistently — before
// this module existed.)

/** Days ahead that count as "due soon", shared by payments and reports. */
export const DUE_SOON_DAYS = 30

/** A dated milestone/instalment that is still outstanding. */
export type DueStatus = 'overdue' | 'due_soon' | 'upcoming'
/** As `DueStatus`, plus 'tbc' for an outstanding item with no date to chase. */
export type ScheduleStatus = DueStatus | 'tbc'

/** Today as `yyyy-mm-dd` (UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** `2026-08-11` → `2026-08-31`. Day 0 of the next month is the last of this one. */
export function endOfMonthIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}

/** Same day-of-month, `n` months on; overflow rolls forward, which is fine for a horizon. */
export function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1 + n, d!)).toISOString().slice(0, 10)
}

export function dueStatus(dueDate: string): DueStatus
export function dueStatus(dueDate: string | null | undefined): ScheduleStatus
export function dueStatus(dueDate: string | null | undefined): ScheduleStatus {
  if (!dueDate) return 'tbc'
  const now = todayIso()
  if (dueDate < now) return 'overdue'
  if (dueDate <= addDaysIso(now, DUE_SOON_DAYS)) return 'due_soon'
  return 'upcoming'
}
