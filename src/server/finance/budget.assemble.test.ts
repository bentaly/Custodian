import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assemble } from './budget'
import { financialYear } from '../../lib/financialYear'

/**
 * `assemble` — the five result sets shaped into the Balance & budget screen.
 *
 * `budget.test.ts` pins the SQL; the pure libs pin the rules. This pins the WIRING between
 * them, which is where a screen goes quietly wrong: a core-cost line reaching one tab and
 * not the other, the two tabs fed from different rows, a budget header with no lines
 * drawing an empty budget.
 */

const TODAY = new Date('2026-09-12T12:00:00Z')
const FY = financialYear(3, TODAY) // 1 Apr 2026 – 31 Mar 2027

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => vi.useRealTimers())

type Input = Parameters<typeof assemble>[0]
type BudgetRow = Input['budgetRows'][number]
type RoundRow = Input['roundRows'][number]

const line = (over: Partial<BudgetRow>): BudgetRow => ({
  lineId: 'line',
  programmeId: null,
  label: null,
  amount: '0',
  frequency: null,
  dueDate: null,
  contingencyPercent: null,
  ...over,
})

const round = (over: Partial<RoundRow>): RoundRow => ({
  roundProgrammeId: 'rp',
  programmeId: 'youth',
  programmeName: 'Youth Futures',
  programmeColour: null,
  budget: '0',
  openedAt: null,
  closedAt: null,
  undecided: '0',
  ...over,
})

const BUDGET: BudgetRow[] = [
  line({ lineId: 'p', programmeId: 'youth', amount: '100000', contingencyPercent: '5' }),
  line({
    lineId: 'r',
    label: 'Rent',
    amount: '24000',
    frequency: 'monthly',
    contingencyPercent: '5',
  }),
  line({
    lineId: 'a',
    label: 'Audit',
    amount: '6000',
    frequency: 'one_off',
    dueDate: '2026-12-01',
    contingencyPercent: '5',
  }),
]

const run = (over: Partial<Input> = {}) =>
  assemble({
    fy: FY,
    balanceRows: [{ amount: '500000', asAtDate: '2026-09-01', note: null, recordedBy: 'Sam' }],
    budgetRows: BUDGET,
    instalmentRows: [
      {
        programmeId: 'youth',
        programmeName: 'Youth Futures',
        programmeColour: null,
        prior: true,
        day: '2026-10-01',
        paid: false,
        amount: '30000',
      },
      {
        programmeId: 'youth',
        programmeName: 'Youth Futures',
        programmeColour: null,
        prior: false,
        day: '2026-09-05',
        paid: true,
        amount: '2000',
      },
    ],
    undatedRows: [{ undated: '750' }],
    roundRows: [
      // Open: held, less what has been awarded against it.
      round({ roundProgrammeId: 'open', budget: '50000', openedAt: new Date('2026-08-01') }),
      // Closed with nothing left to decide: released.
      round({ roundProgrammeId: 'done', budget: '80000', closedAt: new Date('2026-06-01') }),
      // Closed, applications still undecided: held.
      round({
        roundProgrammeId: 'pending',
        budget: '20000',
        closedAt: new Date('2026-07-01'),
        undecided: '3',
      }),
    ],
    awardedThisYear: new Map([
      ['open', 10_000],
      ['done', 60_000],
    ]),
    ...over,
  })

describe('assemble', () => {
  it('holds open and undecided round budgets and releases decided ones', () => {
    const current = run().summary.lines.find((l) => l.kind === 'current')!
    expect(current.projected).toBe(40_000 + 20_000)
  })

  it('reads contingency off the budget header, as a share of the programme lines', () => {
    const { summary } = run()
    expect(summary.contingency).toEqual({ percent: 5, amount: 5_000 })
  })

  it('feeds both tabs from the same instalments and core-cost lines', () => {
    const d = run()
    expect(d.summary.lines.find((l) => l.kind === 'core')!.children.map((c) => c.name)).toEqual([
      'Audit',
      'Rent',
    ])
    expect(d.hasCoreCosts).toBe(true)
    // What leaves the account is the cash flow's; projection and contingency are on top.
    expect(d.summary.available).toBe(d.cashFlow.headroom! - 60_000 - 5_000)
  })

  it('passes undated instalments through for the note', () => {
    expect(run().undated).toBe(750)
  })

  it('treats a budget header with no lines as no budget, no core costs and no contingency', () => {
    const d = run({ budgetRows: [line({ lineId: null, amount: null, contingencyPercent: '5' })] })
    expect(d.hasCoreCosts).toBe(false)
    expect(d.summary.contingency).toBeNull()
    expect(d.summary.lines.map((l) => l.kind)).toEqual(['prior', 'current'])
    expect(d.empty).toBe(false)
  })

  it('has no available balance without a reading, and is empty with nothing at all', () => {
    const noBalance = run({ balanceRows: [] })
    expect(noBalance.summary.available).toBeNull()
    expect(noBalance.cashFlow.headroom).toBeNull()
    expect(noBalance.empty).toBe(false)

    const nothing = run({ balanceRows: [], budgetRows: [], instalmentRows: [], roundRows: [] })
    expect(nothing.empty).toBe(true)
  })
})
