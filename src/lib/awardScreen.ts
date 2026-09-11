// ─── The award screen's words ────────────────────────────────────────────────
//
// The sentences the grant screen (Figma 1347:540) builds out of dates and scores, pulled
// out of the route so the rules are testable without rendering anything. The schedule
// itself is `grantTimeline` (`lib/reportTimeline`) — the same line the report screen
// draws, so a grant reads in the same order from either side.

import { daysBetweenIso } from './schedule'
import type { GrantTimelineEntry } from './reportTimeline'

/** The schedule card's filter: everything, only the money, or only the reporting. */
export type ScheduleFilter = 'all' | 'payments' | 'reports'

/**
 * Whether an entry survives the filter. "Grant awarded" is in Everything only — it is
 * neither a payment nor a report, and heading a list of instalments with it would make
 * the award read as the first of them.
 */
export function inScheduleFilter(kind: GrantTimelineEntry['kind'], filter: ScheduleFilter) {
  if (filter === 'all') return true
  return filter === 'payments' ? kind === 'instalment' : kind === 'report'
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

export type PillTone = 'grey' | 'danger' | 'success'

/**
 * The pill at the top of the payments card: how far away the next payment is.
 *
 * Counted in days rather than restated as a date, because the date is printed on the
 * line beneath it and the pill's job is the one thing a date makes you work out. Null
 * when the grant has no schedule at all — a pill saying "Paid in full" over nothing
 * would be claiming something about money that was never arranged.
 */
export function nextPaymentPill(
  next: { dueDate: string | null } | null,
  hasSchedule: boolean,
  today: string,
): { text: string; tone: PillTone } | null {
  if (!hasSchedule) return null
  if (!next) return { text: 'Paid in full', tone: 'success' }
  if (!next.dueDate) return { text: 'Next payment date to be confirmed', tone: 'grey' }
  const d = daysBetweenIso(today, next.dueDate)
  if (d < 0) return { text: `Payment overdue by ${days(-d)}`, tone: 'danger' }
  if (d === 0) return { text: 'Next payment due today', tone: 'grey' }
  if (d === 1) return { text: 'Next payment due tomorrow', tone: 'grey' }
  return { text: `Next payment in ${days(d)}`, tone: 'grey' }
}

/**
 * When a scheduled report arrived, against the day it was due: "3 days before it was
 * due", "on the day it was due", "12 days late". Early is worth saying, not just late —
 * a grantee who reports ahead of time is telling the foundation something.
 */
export function arrivalPhrase(arrived: string, due: string): string {
  const d = daysBetweenIso(arrived, due)
  if (d === 0) return 'on the day it was due'
  return d > 0 ? `${days(d)} before it was due` : `${days(-d)} late`
}

/**
 * What the "Grant awarded" line says about the award letter. The letter is usually sent
 * the day the award is made, and saying so is the reassurance; anything else — sent
 * later, never sent, failed — is the thing worth reading.
 */
export function letterPhrase(
  decidedOn: string,
  letter: { status: string; sentAt: string | null } | null,
  fmtDate: (d: string) => string,
): string | null {
  if (!letter) return null
  if (letter.status === 'failed') return 'letter failed to send'
  if (letter.status !== 'sent' || !letter.sentAt) return 'letter not sent yet'
  return letter.sentAt.slice(0, 10) === decidedOn.slice(0, 10)
    ? 'letter sent the same day'
    : `letter sent ${fmtDate(letter.sentAt)}`
}

type Alignment = { score: number } | null

/**
 * One alignment figure for the whole grant: the mean of its reports' own headline
 * scores, each of which is the mean of the alignments that report has (see
 * `AlignmentSummary`). Averaged per report FIRST so a report the model scored on one
 * question counts once, the same as one scored on both. Out of 10, because its parts are
 * — an alignment is a criterion, and a criterion is never restated on the composite's
 * scale. Null when no report has been scored.
 */
export function averageAlignment(
  reports: Array<{ applicationAlignment: Alignment; programmeAlignment: Alignment }>,
): { score: number; reports: number } | null {
  const perReport: number[] = []
  for (const r of reports) {
    const scores = [r.applicationAlignment?.score, r.programmeAlignment?.score].filter(
      (n): n is number => typeof n === 'number',
    )
    if (scores.length) perReport.push(scores.reduce((t, n) => t + n, 0) / scores.length)
  }
  if (perReport.length === 0) return null
  return {
    score: perReport.reduce((t, n) => t + n, 0) / perReport.length,
    reports: perReport.length,
  }
}
