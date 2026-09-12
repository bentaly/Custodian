import { describe, it, expect } from 'vitest'
import {
  againstProposal,
  grantTimeline,
  impactToDate,
  reportingTimeline,
  type TimelineMilestone,
  type TimelineReport,
} from './reportTimeline'

const milestone = (over: Partial<TimelineMilestone> & { id: string }): TimelineMilestone => ({
  label: 'Interim report',
  dueDate: '2026-06-01',
  submittedDate: null,
  ...over,
})

const report = (over: Partial<TimelineReport> & { id: string }): TimelineReport => ({
  scheduleId: null,
  submittedAt: '2026-06-03T10:00:00.000Z',
  importBatchId: null,
  impactQuantity: null,
  impactUnitLabel: null,
  ...over,
})

const nobody = { milestoneId: null, reportId: null }

describe('reportingTimeline', () => {
  it('dates a milestone by when its report arrived, or when it is due', () => {
    const entries = reportingTimeline(
      [
        milestone({ id: 'interim', dueDate: '2026-06-01', submittedDate: '2027-01-10' }),
        milestone({ id: 'final', label: 'Final report', dueDate: '2026-12-01' }),
      ],
      [report({ id: 'r1', scheduleId: 'interim', submittedAt: '2027-01-10T09:00:00.000Z' })],
      nobody,
    )
    expect(entries[0]).toMatchObject({ received: true, date: '2027-01-10', dueStatus: null })
    expect(entries[1]).toMatchObject({ received: false, date: '2026-12-01' })
  })

  it('lists a report answering no milestone under its own id', () => {
    const entries = reportingTimeline(
      [milestone({ id: 'm1' })],
      [report({ id: 'loose', submittedAt: '2026-05-20T12:00:00.000Z' })],
      nobody,
    )
    expect(entries[1]).toMatchObject({
      key: 'loose',
      label: 'Unscheduled report',
      received: true,
      date: '2026-05-20',
    })
  })

  it('names an imported impact figure for what it is', () => {
    const [entry] = reportingTimeline([], [report({ id: 'imp', importBatchId: 'batch-1' })], nobody)
    expect(entry!.label).toBe('Imported impact figure')
  })

  it('marks the report on screen whichever key it was opened by', () => {
    const milestones = [milestone({ id: 'm1', submittedDate: '2026-06-03' })]
    const reports = [report({ id: 'r1', scheduleId: 'm1' })]
    for (const current of [
      { milestoneId: 'm1', reportId: 'r1' },
      { milestoneId: null, reportId: 'r1' },
    ]) {
      const [entry] = reportingTimeline(milestones, reports, current)
      expect(entry).toMatchObject({ here: true, openable: false })
    }
  })

  it('does not link a milestone ticked by hand with no report behind it', () => {
    const [entry] = reportingTimeline(
      [milestone({ id: 'm1', submittedDate: '2026-06-02' })],
      [],
      nobody,
    )
    expect(entry).toMatchObject({ received: true, date: '2026-06-02', openable: false })
  })

  it('links a milestone still awaited, so a late report can be chased from it', () => {
    const [entry] = reportingTimeline([milestone({ id: 'm1' })], [], nobody)
    expect(entry).toMatchObject({ received: false, openable: true })
  })
})

describe('grantTimeline', () => {
  const reporting = reportingTimeline(
    [
      milestone({ id: 'annual', label: 'Annual report', dueDate: '2026-08-01' }),
      milestone({ id: 'final', label: 'Final report', dueDate: '2027-08-01' }),
    ],
    [report({ id: 'r1', scheduleId: 'annual', submittedAt: '2026-08-12T09:00:00.000Z' })],
    { milestoneId: 'annual', reportId: 'r1' },
  )
  const entries = grantTimeline({
    decisionAt: '2026-07-24T10:00:00.000Z',
    amountAwarded: 38000,
    instalments: [
      { id: 'i1', amount: 19000, dueDate: '2026-08-01', paidDate: '2026-08-07' },
      { id: 'i2', amount: 19000, dueDate: '2027-08-03', paidDate: null },
      { id: 'i3', amount: 0, dueDate: null, paidDate: null },
    ],
    reporting,
  })

  it('interleaves money and reports by the date each shows, the award first', () => {
    // Paid 7 Aug, report in 12 Aug; then the final report (due 1 Aug 2027) before the
    // second payment (due 3 Aug 2027).
    expect(entries.map((e) => e.key)).toEqual(['awarded', 'i1', 'annual', 'final', 'i2', 'i3'])
  })

  it('dates a paid instalment by when it was paid, an unpaid one by when it is due', () => {
    expect(entries[1]).toMatchObject({
      kind: 'instalment',
      date: '2026-08-07',
      done: true,
      n: 1,
      of: 3,
    })
    expect(entries[4]).toMatchObject({ kind: 'instalment', date: '2027-08-03', done: false })
  })

  it('puts an instalment with no date at the end', () => {
    expect(entries.at(-1)).toMatchObject({ key: 'i3', date: null, dueStatus: 'tbc' })
  })

  it('carries the report on screen through', () => {
    expect(entries[2]).toMatchObject({ kind: 'report', here: true, done: true })
  })

  it('orders the award, then money, then reports on the same day', () => {
    const sameDay = grantTimeline({
      decisionAt: '2026-07-24T10:00:00.000Z',
      amountAwarded: 1000,
      instalments: [{ id: 'i1', amount: 1000, dueDate: null, paidDate: '2026-07-24' }],
      reporting: reportingTimeline(
        [],
        [report({ id: 'r1', submittedAt: '2026-07-24T08:00:00.000Z' })],
        nobody,
      ),
    })
    expect(sameDay.map((e) => e.kind)).toEqual(['awarded', 'instalment', 'report'])
  })
})

describe('impactToDate', () => {
  const entries = reportingTimeline(
    [
      milestone({ id: 'interim', dueDate: '2026-06-01', submittedDate: '2026-06-03' }),
      milestone({
        id: 'final',
        label: 'Final report',
        dueDate: '2026-12-01',
        submittedDate: '2026-12-02',
      }),
    ],
    [
      report({
        id: 'r1',
        scheduleId: 'interim',
        submittedAt: '2026-06-03T10:00:00.000Z',
        impactQuantity: 150,
      }),
      report({
        id: 'r2',
        scheduleId: 'final',
        submittedAt: '2026-12-02T10:00:00.000Z',
        impactQuantity: 260,
      }),
    ],
    nobody,
  )

  it('adds up every report up to and including this one', () => {
    expect(impactToDate(entries, '2026-12-02T10:00:00.000Z')).toEqual({ total: 410, reports: 2 })
  })

  it('leaves out reports that arrived after this one', () => {
    expect(impactToDate(entries, '2026-06-03T10:00:00.000Z')).toEqual({ total: 150, reports: 1 })
  })
})

describe('againstProposal', () => {
  const units = { reported: 'Households', proposed: 'Households' }

  it('states a single report against the proposal, as the design has it', () => {
    expect(againstProposal({ total: 391, reports: 1 }, 359, units)).toEqual({
      text: '32 more than the 359 proposed',
      ahead: true,
    })
    expect(againstProposal({ total: 300, reports: 1 }, 359, units)).toEqual({
      text: '59 short of the 359 proposed',
      ahead: false,
    })
    expect(againstProposal({ total: 359, reports: 1 }, 359, units)?.text).toBe(
      'exactly as proposed',
    )
  })

  it('states several reports as progress towards the proposal', () => {
    expect(againstProposal({ total: 410, reports: 2 }, 600, units)).toEqual({
      text: '410 of 600 proposed so far',
      ahead: false,
    })
    expect(againstProposal({ total: 710, reports: 3 }, 600, units)).toEqual({
      text: '710 so far, 110 more than proposed',
      ahead: true,
    })
  })

  it('says nothing with no proposal to measure against', () => {
    expect(againstProposal({ total: 391, reports: 1 }, null, units)).toBeNull()
    expect(againstProposal({ total: 391, reports: 1 }, 0, units)).toBeNull()
  })

  it('says nothing when the report counted in a different unit from the proposal', () => {
    expect(
      againstProposal({ total: 391, reports: 1 }, 359, {
        reported: 'Households',
        proposed: 'People',
      }),
    ).toBeNull()
  })

  it('compares units without regard to case', () => {
    expect(
      againstProposal({ total: 391, reports: 1 }, 359, {
        reported: 'households',
        proposed: 'Households',
      }),
    ).not.toBeNull()
  })
})
