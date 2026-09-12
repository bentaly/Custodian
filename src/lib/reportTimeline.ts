// ─── A grant's life, as one timeline ─────────────────────────────────────────
//
// The report screen's Timeline card: the award, every payment and every reporting date
// in ONE line, in date order, with the report being read marked in place. The design
// had two cards (Reporting, Finance), and "Grant awarded" sat at the head of the
// reporting one only — so a grant with one report drew a two-step line whose first step
// was not a report at all. A grant is one sequence of events; money out and reports in
// interleave, and the order they happened in is the thing worth reading.
//
// Pure, so the rules below are testable without a database. `getReport` feeds it.

import { dueStatus, type DueStatus, type ScheduleStatus } from './schedule'
import { reportLabel } from './reportLabel'

export interface TimelineMilestone {
  id: string
  label: string
  dueDate: string
  /** Set when the milestone is received — by a report arriving, or ticked by hand. */
  submittedDate: string | null
}

export interface TimelineReport {
  id: string
  scheduleId: string | null
  /** ISO timestamp. */
  submittedAt: string
  importBatchId: string | null
  impactQuantity: number | null
  impactUnitLabel: string | null
}

export interface ReportingEntry {
  /** What `/reports/$reportKey` takes: the milestone id, or the report's own id for a
   *  report that answers no milestone — the same key the Reports list links with. */
  key: string
  label: string
  received: boolean
  /** Received: the day it arrived. Not yet received: the day it is due. */
  date: string | null
  /** Only for an entry still awaited. */
  dueStatus: DueStatus | null
  /** ISO timestamp of the report behind the entry, if one arrived. */
  submittedAt: string | null
  impactQuantity: number | null
  impactUnitLabel: string | null
  /** The report on screen. */
  here: boolean
  /**
   * Whether there is a page worth opening. Not for the one already open, and not for a
   * milestone ticked by hand with no document behind it — its page would say the
   * report "has not been received yet", which is the opposite of what the tick says.
   */
  openable: boolean
}

export function reportingTimeline(
  milestones: TimelineMilestone[],
  reports: TimelineReport[],
  current: { milestoneId: string | null; reportId: string | null },
): ReportingEntry[] {
  const milestoneIds = new Set(milestones.map((m) => m.id))
  const reportBySchedule = new Map<string, TimelineReport>()
  for (const r of reports) {
    if (r.scheduleId && !reportBySchedule.has(r.scheduleId)) reportBySchedule.set(r.scheduleId, r)
  }

  const entries: ReportingEntry[] = []

  for (const m of milestones) {
    const r = reportBySchedule.get(m.id) ?? null
    const received = Boolean(m.submittedDate || r)
    const here = m.id === current.milestoneId || (r != null && r.id === current.reportId)
    entries.push({
      key: m.id,
      label: m.label,
      received,
      date: r ? r.submittedAt.slice(0, 10) : received ? m.submittedDate : m.dueDate,
      dueStatus: received ? null : dueStatus(m.dueDate),
      submittedAt: r?.submittedAt ?? null,
      impactQuantity: r?.impactQuantity ?? null,
      impactUnitLabel: r?.impactUnitLabel ?? null,
      here,
      openable: !here && (r != null || !received),
    })
  }

  // Reports that answer no milestone: sent unasked, or an impact figure the onboarding
  // import recorded.
  for (const r of reports) {
    if (r.scheduleId && milestoneIds.has(r.scheduleId)) continue
    const here = r.id === current.reportId
    entries.push({
      key: r.id,
      label: reportLabel(null, r.importBatchId !== null),
      received: true,
      date: r.submittedAt.slice(0, 10),
      dueStatus: null,
      submittedAt: r.submittedAt,
      impactQuantity: r.impactQuantity,
      impactUnitLabel: r.impactUnitLabel,
      here,
      openable: !here,
    })
  }

  return entries
}

export interface TimelineInstalment {
  id: string
  amount: number
  dueDate: string | null
  paidDate: string | null
}

export type GrantTimelineEntry =
  | { kind: 'awarded'; key: string; date: string; done: true; amount: number }
  | {
      kind: 'instalment'
      key: string
      /** Paid: the day it was paid. Unpaid: the day it is due, or null for "date TBC". */
      date: string | null
      done: boolean
      /** 1-based position in the schedule, and the schedule's length. */
      n: number
      of: number
      amount: number
      /** Only for one still unpaid. */
      dueStatus: ScheduleStatus | null
    }
  | ({ kind: 'report'; done: boolean } & ReportingEntry)

/** Where a kind falls among entries on the same day: the award, then money, then reports. */
const SAME_DAY_ORDER: Record<GrantTimelineEntry['kind'], number> = {
  awarded: 0,
  instalment: 1,
  report: 2,
}

/**
 * The award, the payments and the reporting as one line, ordered by the date each
 * entry SHOWS: when it happened if it has, when it is due if not. That one rule is what
 * keeps the line honest — a report received late sits after the payment that went out
 * before it arrived. An instalment with no date yet ("TBC") goes at the end, in schedule
 * order: it has no place in time to be put in.
 */
export function grantTimeline(input: {
  decisionAt: string
  amountAwarded: number
  instalments: TimelineInstalment[]
  reporting: ReportingEntry[]
}): GrantTimelineEntry[] {
  const entries: GrantTimelineEntry[] = [
    {
      kind: 'awarded',
      key: 'awarded',
      date: input.decisionAt.slice(0, 10),
      done: true,
      amount: input.amountAwarded,
    },
    ...input.instalments.map(
      (p, i): GrantTimelineEntry => ({
        kind: 'instalment',
        key: p.id,
        date: p.paidDate ?? p.dueDate,
        done: p.paidDate != null,
        n: i + 1,
        of: input.instalments.length,
        amount: p.amount,
        dueStatus: p.paidDate ? null : dueStatus(p.dueDate),
      }),
    ),
    ...input.reporting.map((e): GrantTimelineEntry => ({ kind: 'report', done: e.received, ...e })),
  ]

  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => {
      const da = a.entry.date
      const db = b.entry.date
      if (da !== db) {
        if (da == null) return 1
        if (db == null) return -1
        return da.localeCompare(db)
      }
      return SAME_DAY_ORDER[a.entry.kind] - SAME_DAY_ORDER[b.entry.kind] || a.i - b.i
    })
    .map(({ entry }) => entry)
}

/**
 * The impact reported on a grant UP TO AND INCLUDING the report on screen.
 *
 * Impact adds up across a grant's reports — Insights and the award screen both sum them
 * — while the application's proposed figure is for the whole grant. So an interim report
 * set against the whole proposal reads as a shortfall when it is only halfway; the
 * honest comparison is everything reported so far. Reports arriving AFTER this one are
 * left out, so an old report still reads as it did on the day it came in.
 */
export function impactToDate(
  entries: ReportingEntry[],
  upTo: string,
): { total: number; reports: number } {
  let total = 0
  let count = 0
  for (const e of entries) {
    if (e.impactQuantity == null || !e.submittedAt || e.submittedAt > upTo) continue
    total += e.impactQuantity
    count += 1
  }
  return { total, reports: count }
}

/** A quantity as the screen prints it — whole numbers whole, a hectare to two places. */
export function fmtQuantity(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

/**
 * The words set beside a report's impact figure, measured against what the application
 * proposed. `ahead` is whether the grant has reached the proposal yet — the one case
 * worth colour. Falling short is stated in the same grey as the unit: on an interim
 * report it is expected, and the screen cannot tell which kind of short this is.
 *
 * Null when there is nothing to measure against, or when the report counted in a
 * different unit from the programme's today — the proposal was made in the programme's
 * unit, and "391 households against 600 people" is not a comparison.
 */
export function againstProposal(
  toDate: { total: number; reports: number },
  proposed: number | null,
  units: { reported: string | null; proposed: string | null },
): { text: string; ahead: boolean } | null {
  if (proposed == null || proposed <= 0 || toDate.reports === 0) return null
  if (
    units.reported &&
    units.proposed &&
    units.reported.trim().toLowerCase() !== units.proposed.trim().toLowerCase()
  ) {
    return null
  }

  const diff = toDate.total - proposed
  const ahead = diff >= 0
  if (toDate.reports === 1) {
    if (diff === 0) return { text: 'exactly as proposed', ahead }
    return {
      text:
        diff > 0
          ? `${fmtQuantity(diff)} more than the ${fmtQuantity(proposed)} proposed`
          : `${fmtQuantity(-diff)} short of the ${fmtQuantity(proposed)} proposed`,
      ahead,
    }
  }
  return {
    text:
      diff > 0
        ? `${fmtQuantity(toDate.total)} so far, ${fmtQuantity(diff)} more than proposed`
        : `${fmtQuantity(toDate.total)} of ${fmtQuantity(proposed)} proposed so far`,
    ahead,
  }
}
