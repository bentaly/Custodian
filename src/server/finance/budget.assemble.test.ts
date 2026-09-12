import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assemble } from './budget'
import { financialYear } from '../../lib/financialYear'

/**
 * `assemble` — the seven result sets shaped into the Balance & budget screen.
 *
 * `budget.test.ts` pins the SQL; the pure libs pin the rules. This pins the WIRING between
 * them, which is where a screen goes quietly wrong: a core-cost line not reaching the cash
 * flow, the card and the table fed from different rows, a budget header with no lines
 * drawing an empty budget.
 */

const TODAY = new Date('2026-09-12T12:00:00Z')
const FY = financialYear(3, TODAY) // 1 Apr 2026 – 31 Mar 2027

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => vi.useRealTimers())

type BudgetRow = Parameters<typeof assemble>[2][number]
const line = (over: Partial<BudgetRow>): BudgetRow => ({
  budgetLabel: '2026/27',
  lineId: 'line',
  programmeId: null,
  label: null,
  amount: '0',
  carriedCommitment: null,
  frequency: null,
  dueDate: null,
  programmeName: null,
  programmeColour: null,
  ...over,
})

const BUDGET: BudgetRow[] = [
  line({ lineId: 'p', programmeId: 'youth', programmeName: 'Youth Futures', amount: '100000' }),
  line({ lineId: 'r', label: 'Rent', amount: '24000', frequency: 'monthly' }),
  line({
    lineId: 'a',
    label: 'Audit',
    amount: '6000',
    frequency: 'one_off',
    dueDate: '2026-12-01',
  }),
]

const run = (
  over: {
    balance?: Parameters<typeof assemble>[1]
    budget?: BudgetRow[]
    instalments?: Parameters<typeof assemble>[7]
  } = {},
) =>
  assemble(
    FY,
    over.balance ?? [{ amount: '50000', asAtDate: '2026-09-01', note: null, recordedBy: 'Sam' }],
    over.budget ?? BUDGET,
    [],
    [{ total: '30000' }],
    [],
    [{ dueByYearEnd: '30000', dueLater: '0', undated: '0' }],
    over.instalments ?? [
      { day: '2026-10-01', paid: false, amount: '30000' },
      { day: '2026-09-05', paid: true, amount: '2000' },
    ],
  )

describe('assemble', () => {
  it('schedules only the non-grant lines, in their stored order', () => {
    const d = run()
    expect(d.coreCosts!.lines.map((l) => l.name)).toEqual(['Rent', 'Audit'])
    // April–August have ended by 12 September: five months of £2,000.
    expect(d.coreCosts!.lines[0]).toMatchObject({ toDate: 10_000, toCome: 14_000 })
    expect(d.coreCosts!.lines[1]).toMatchObject({ toDate: 0, toCome: 6_000 })
    // The commitment rollup still carries every line, core costs at zero actuals.
    expect(d.budget!.lines).toHaveLength(3)
    expect(d.budget!.used).toBe(0)
  })

  it('projects the balance from its as-at date, core costs included', () => {
    const { cashFlow } = run()
    expect(cashFlow.sinceBalance).toEqual({
      paidGrants: 2_000, // paid 5 September, after the 1 September reading
      dueGrants: 30_000,
      core: 7 * 2_000 + 6_000, // rent September–March, and the audit
    })
    expect(cashFlow.headroom).toBe(50_000 - 2_000 - 30_000 - 20_000)
  })

  it('ends the month table on exactly the headroom figure', () => {
    const { cashFlow } = run()
    expect(cashFlow.months).toHaveLength(12)
    expect(cashFlow.months.at(-1)!.closing).toBe(cashFlow.headroom)
  })

  it('agrees with the dueByYearEnd bucket on what grants still owe', () => {
    const d = run()
    expect(d.cashFlow.sinceBalance!.dueGrants).toBe(d.outstanding.dueByYearEnd)
  })

  it('treats a budget header with no lines as no budget and no core costs', () => {
    const d = run({ budget: [line({ lineId: null, amount: null })] })
    expect(d.budget).toBeNull()
    expect(d.coreCosts).toBeNull()
    // The cash flow still stands on the instalments and the balance alone.
    expect(d.cashFlow.headroom).toBe(50_000 - 2_000 - 30_000)
    expect(d.empty).toBe(false)
  })

  it('has no headroom without a balance, and is empty with neither half', () => {
    const noBalance = run({ balance: [] })
    expect(noBalance.cashFlow.headroom).toBeNull()
    expect(noBalance.cashFlow.sinceBalance).toBeNull()
    expect(noBalance.empty).toBe(false)

    const nothing = run({ balance: [], budget: [] })
    expect(nothing.empty).toBe(true)
    expect(nothing.coreCosts).toBeNull()
  })

  it('reads a NULL frequency on an old cost row as monthly', () => {
    const d = run({ budget: [line({ label: 'Old', amount: '1200', frequency: null })] })
    expect(d.coreCosts!.lines[0]).toMatchObject({ frequency: 'monthly', perMonth: 100 })
  })
})
