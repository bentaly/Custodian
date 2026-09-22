import { describe, expect, it } from 'vitest'
import {
  grantCreditorLine,
  grantCreditors,
  oneYearAfter,
  type CreditorGrant,
} from './grantCreditors'

const YE = '2026-03-31'

function grant(over: Partial<CreditorGrant> = {}): CreditorGrant {
  return {
    awardId: 'a1',
    organisationName: 'Wrenfield Trust',
    reference: 'WF-001',
    programmeName: 'Youth',
    roundName: 'Spring 2025',
    decisionDate: '2025-04-15',
    amountAwarded: 60000,
    instalments: [
      { amount: 20000, dueDate: '2025-05-01', paidDate: '2025-05-02' },
      { amount: 20000, dueDate: '2026-05-01', paidDate: null },
      { amount: 20000, dueDate: '2027-05-01', paidDate: null },
    ],
    ...over,
  }
}

describe('grantCreditorLine', () => {
  it("splits the proposal's worked example: £60,000 over three years, one paid", () => {
    const line = grantCreditorLine(grant(), YE)!
    expect(line.paidByYearEnd).toBe(20000)
    expect(line.dueWithinOneYear).toBe(20000)
    expect(line.dueAfterOneYear).toBe(20000)
    expect(line.noDueDate).toBe(0)
    expect(line.totalUnpaid).toBe(40000)
  })

  it('counts an instalment paid AFTER the year end as unpaid on it', () => {
    const g = grant()
    g.instalments[1] = { amount: 20000, dueDate: '2026-05-01', paidDate: '2026-05-03' }
    const line = grantCreditorLine(g, YE)!
    expect(line.paidByYearEnd).toBe(20000)
    expect(line.dueWithinOneYear).toBe(20000)
  })

  it('puts arrears, and a payment due on the anniversary, within one year', () => {
    const line = grantCreditorLine(
      grant({
        instalments: [
          { amount: 20000, dueDate: '2025-06-01', paidDate: null },
          { amount: 20000, dueDate: '2027-03-31', paidDate: null },
          { amount: 20000, dueDate: '2027-04-01', paidDate: null },
        ],
      }),
      YE,
    )!
    expect(line.dueWithinOneYear).toBe(40000)
    expect(line.dueAfterOneYear).toBe(20000)
  })

  it('gives undated instalments and an unscheduled remainder their own column', () => {
    const line = grantCreditorLine(
      grant({
        instalments: [
          { amount: 20000, dueDate: '2025-05-01', paidDate: '2025-05-01' },
          { amount: 15000, dueDate: null, paidDate: null },
        ],
      }),
      YE,
    )!
    expect(line.noDueDate).toBe(40000)
    expect(line.totalUnpaid).toBe(40000)
  })

  it('leaves out a grant decided after the year end, and one fully paid by it', () => {
    expect(grantCreditorLine(grant({ decisionDate: '2026-04-01' }), YE)).toBeNull()
    expect(
      grantCreditorLine(
        grant({
          amountAwarded: 20000,
          instalments: [{ amount: 20000, dueDate: '2025-05-01', paidDate: '2025-05-01' }],
        }),
        YE,
      ),
    ).toBeNull()
  })

  it('does not drift a penny on thirds', () => {
    const line = grantCreditorLine(
      grant({
        amountAwarded: 10000,
        instalments: [
          { amount: 3333.33, dueDate: '2025-05-01', paidDate: '2025-05-01' },
          { amount: 3333.33, dueDate: '2026-05-01', paidDate: null },
          { amount: 3333.34, dueDate: '2027-05-01', paidDate: null },
        ],
      }),
      YE,
    )!
    expect(line.totalUnpaid).toBe(6666.67)
    expect(line.noDueDate).toBe(0)
  })
})

describe('grantCreditors', () => {
  it('totals the two figures the accounts need', () => {
    const report = grantCreditors(
      [grant(), grant({ awardId: 'a2', organisationName: 'Arete', amountAwarded: 60000 })],
      YE,
    )
    expect(report.lines.map((l) => l.organisationName)).toEqual(['Arete', 'Wrenfield Trust'])
    expect(report.totals).toMatchObject({
      count: 2,
      dueWithinOneYear: 40000,
      dueAfterOneYear: 40000,
      totalUnpaid: 80000,
    })
    expect(report.oneYearOn).toBe('2027-03-31')
  })
})

describe('oneYearAfter', () => {
  it('keeps a month-end year end on the month end', () => {
    expect(oneYearAfter('2028-02-29')).toBe('2029-02-28')
    expect(oneYearAfter('2026-12-31')).toBe('2027-12-31')
  })
})
