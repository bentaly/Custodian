import { describe, it, expect } from 'vitest'
import {
  awardIsComplete,
  deriveAwardStatus,
  isArrivedReport,
  type CompletionInputs,
} from './awardCompletion'

const paid = { paidDate: '2026-01-31' }
const unpaid = { paidDate: null }
const received = { submittedDate: '2026-02-14' }
const awaited = { submittedDate: null }

/** An arrived report, reviewed or not. */
const report = (reviewed: boolean) => ({
  reviewedAt: reviewed ? new Date('2026-03-01') : null,
  scheduleId: 'milestone-1',
  importBatchId: null,
})

/** A figure the onboarding import parked in `reports`; nobody submitted it. */
const importedFigure = { reviewedAt: null, scheduleId: null, importBatchId: 'batch-1' }

const inputs = (over: Partial<CompletionInputs> = {}): CompletionInputs => ({
  instalments: [paid],
  milestones: [received],
  reports: [report(true)],
  ...over,
})

describe('awardIsComplete', () => {
  it('completes a grant whose money is out, reports are in and sign-off is done', () => {
    expect(awardIsComplete(inputs())).toBe(true)
  })

  it('holds a grant open while any instalment is unpaid', () => {
    expect(awardIsComplete(inputs({ instalments: [paid, unpaid] }))).toBe(false)
  })

  it('holds a fully-paid grant open while a report is still awaited', () => {
    expect(awardIsComplete(inputs({ milestones: [received, awaited] }))).toBe(false)
  })

  it('holds a fully-reported grant open until the report has been reviewed', () => {
    expect(awardIsComplete(inputs({ reports: [report(false)] }))).toBe(false)
  })

  it('completes a grant that expects no reports at all', () => {
    expect(awardIsComplete(inputs({ milestones: [], reports: [] }))).toBe(true)
  })

  // The asymmetry with the case above, and the one that would complete every grant the
  // moment it was minted: an empty payment schedule is not "all paid".
  it('never completes a grant with no instalments', () => {
    expect(awardIsComplete(inputs({ instalments: [] }))).toBe(false)
  })

  // Requiring sign-off on these would strand every imported portfolio at `active`
  // forever — there is no document to read, only a number from a workbook.
  it('does not wait for review of an imported impact figure', () => {
    expect(awardIsComplete(inputs({ reports: [report(true), importedFigure] }))).toBe(true)
  })

  it('does wait for review of a report that answered no milestone', () => {
    const unscheduled = { reviewedAt: null, scheduleId: null, importBatchId: null }
    expect(awardIsComplete(inputs({ reports: [unscheduled] }))).toBe(false)
  })
})

describe('isArrivedReport', () => {
  it('counts an ordinary submission and an imported row that answers a milestone', () => {
    expect(isArrivedReport(report(false))).toBe(true)
    expect(isArrivedReport({ ...importedFigure, scheduleId: 'milestone-1' })).toBe(true)
  })

  it('excludes an imported figure answering nothing', () => {
    expect(isArrivedReport(importedFigure)).toBe(false)
  })
})

describe('deriveAwardStatus', () => {
  it('moves between active and completed in both directions', () => {
    expect(deriveAwardStatus('active', inputs())).toBe('completed')
    expect(deriveAwardStatus('completed', inputs({ reports: [report(false)] }))).toBe('active')
  })

  it('never resurrects a cancelled grant, however complete its rows look', () => {
    expect(deriveAwardStatus('cancelled', inputs())).toBe('cancelled')
  })
})
