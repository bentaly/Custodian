import { describe, expect, it } from 'vitest'
import { buildCashFlow, type InstalmentDay } from './cashFlow'
import { financialYear } from './financialYear'

const FY = financialYear(3, new Date('2026-09-12T12:00:00Z')) // 1 Apr 2026 – 31 Mar 2027
const TODAY = '2026-09-12'

const paid = (day: string, amount: number): InstalmentDay => ({ day, paid: true, amount })
const due = (day: string, amount: number): InstalmentDay => ({ day, paid: false, amount })
const rent = { label: 'Rent', amount: 12_000, frequency: 'monthly', dueDate: null }

const month = (cf: ReturnType<typeof buildCashFlow>, key: string) =>
  cf.months.find((m) => m.key === key)!

describe('buildCashFlow', () => {
  it('draws paid instalments on their paid date and unpaid ones on their due date', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: null,
      instalments: [paid('2026-05-10', 5_000), due('2026-11-01', 7_000)],
      costLines: [rent],
    })
    expect(month(cf, '2026-05')).toMatchObject({
      grants: 5_000,
      core: 1_000,
      total: 6_000,
      past: true,
    })
    expect(month(cf, '2026-11')).toMatchObject({ grants: 7_000, core: 1_000, past: false })
    expect(month(cf, '2026-09').current).toBe(true)
    // No reading, nothing to project.
    expect(cf.headroom).toBeNull()
    expect(cf.months.every((m) => m.closing === null)).toBe(true)
  })

  it('draws an OVERDUE unpaid instalment in the current month, not the past one', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: null,
      instalments: [due('2026-06-01', 3_000)],
      costLines: [],
    })
    expect(month(cf, '2026-06').grants).toBe(0)
    expect(month(cf, '2026-09')).toMatchObject({ grants: 3_000, overdue: 3_000 })
  })

  it('ignores a paid instalment from before the year in the months but not in the projection', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      // Recorded in March, before this year began.
      balance: { amount: 100_000, asAtDate: '2026-03-20' },
      instalments: [paid('2026-03-25', 4_000)],
      costLines: [],
    })
    expect(cf.months.reduce((s, m) => s + m.grants, 0)).toBe(0)
    expect(cf.sinceBalance!.paidGrants).toBe(4_000)
    expect(cf.headroom).toBe(96_000)
  })

  it('subtracts only what leaves AFTER the reading', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: { amount: 200_000, asAtDate: '2026-07-15' },
      instalments: [
        paid('2026-06-01', 50_000), // before the reading: already in the balance
        paid('2026-08-10', 10_000), // after it: the case the old headroom missed
        due('2026-05-01', 2_000), // overdue and unpaid: still to come
        due('2027-02-01', 30_000),
      ],
      costLines: [rent], // £1,000 at each month end; July to March after the 15 July reading = 9
    })
    expect(cf.sinceBalance).toEqual({ paidGrants: 10_000, dueGrants: 32_000, core: 9_000 })
    expect(cf.headroom).toBe(200_000 - 10_000 - 32_000 - 9_000)
  })

  it('projects closing balances from the reading month on, ending exactly at headroom', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: { amount: 200_000, asAtDate: '2026-07-15' },
      instalments: [paid('2026-08-10', 10_000), due('2027-02-01', 30_000)],
      costLines: [rent],
    })
    expect(month(cf, '2026-06').closing).toBeNull()
    expect(month(cf, '2026-07').closing).toBe(199_000)
    expect(month(cf, '2026-08').closing).toBe(188_000)
    expect(cf.months.at(-1)!.closing).toBe(cf.headroom)
  })

  it('counts an unpaid instalment due on the reading day itself', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: { amount: 10_000, asAtDate: TODAY },
      instalments: [due(TODAY, 4_000)],
      costLines: [],
    })
    expect(cf.headroom).toBe(6_000)
  })

  it('goes negative when the year needs more than the balance holds', () => {
    const cf = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: { amount: 5_000, asAtDate: TODAY },
      instalments: [due('2026-12-01', 20_000)],
      costLines: [],
    })
    expect(cf.headroom).toBe(-15_000)
  })
})
