import { describe, expect, it } from 'vitest'
import {
  buildBalanceSummary,
  type BalanceSummaryInput,
  type GrantInstalment,
  type RoundProgrammeBudget,
} from './balanceSummary'
import { buildCashFlow } from './cashFlow'

const FY = { start: '2026-04-01', end: '2027-03-31' }
const TODAY = '2026-09-12'

const inst = (over: Partial<GrantInstalment>): GrantInstalment => ({
  programmeId: 'warm',
  programmeName: 'Warm Homes',
  programmeColour: null,
  prior: false,
  day: '2026-10-01',
  paid: false,
  amount: 0,
  ...over,
})

const rp = (over: Partial<RoundProgrammeBudget>): RoundProgrammeBudget => ({
  programmeId: 'warm',
  programmeName: 'Warm Homes',
  programmeColour: null,
  budget: 0,
  awardedThisYear: 0,
  held: true,
  ...over,
})

const base = (over: Partial<BalanceSummaryInput> = {}): BalanceSummaryInput => ({
  fy: FY,
  today: TODAY,
  balance: { amount: 500_000, asAtDate: '2026-09-01' },
  costLines: [],
  instalments: [],
  roundProgrammes: [],
  programmeBudgets: new Map(),
  contingencyPercent: null,
  ...over,
})

describe('buildBalanceSummary', () => {
  it("works the doc's £400k example: actual, projected, still to pay", () => {
    // Spring round decided: £150k awarded, £60k of it paid before the reading.
    // Summer round open: £120k budget. Winter round upcoming: £130k budget.
    const s = buildBalanceSummary(
      base({
        instalments: [
          inst({ paid: true, day: '2026-06-01', amount: 60_000 }),
          inst({ paid: false, day: '2026-12-01', amount: 90_000 }),
        ],
        roundProgrammes: [
          rp({ budget: 150_000, awardedThisYear: 150_000, held: false }),
          rp({ budget: 120_000 }),
          rp({ budget: 130_000 }),
        ],
      }),
    )
    const current = s.lines.find((l) => l.kind === 'current')!
    expect(current).toMatchObject({ actual: 60_000, projected: 250_000, stillToPay: 90_000 })
    expect(s.deducted).toBe(340_000)
    expect(s.available).toBe(500_000 - 340_000)
  })

  it('holds only what is left of a round budget, and releases a decided round', () => {
    const s = buildBalanceSummary(
      base({
        roundProgrammes: [
          rp({ budget: 100_000, awardedThisYear: 30_000 }),
          rp({ budget: 80_000, awardedThisYear: 50_000, held: false }),
          // Awarded past its budget: nothing negative is held.
          rp({ budget: 10_000, awardedThisYear: 12_000 }),
        ],
      }),
    )
    expect(s.lines[0]!.projected).toBe(70_000)
  })

  it('deducts a payment made after the reading, though it is actual', () => {
    const s = buildBalanceSummary(
      base({
        instalments: [
          inst({ paid: true, day: '2026-08-15', amount: 10_000 }), // before the 1 Sep reading
          inst({ paid: true, day: '2026-09-05', amount: 4_000 }), // after it
        ],
      }),
    )
    expect(s.lines[0]).toMatchObject({ actual: 14_000, stillToPay: 0 })
    expect(s.sinceBalance).toEqual({ grants: 4_000, core: 0, total: 4_000 })
    expect(s.available).toBe(500_000 - 4_000)
  })

  it('splits grants by the round year and breaks each down by programme', () => {
    const s = buildBalanceSummary(
      base({
        instalments: [
          inst({ prior: true, programmeId: 'y', programmeName: 'Youth Futures', amount: 20_000 }),
          inst({ prior: true, programmeId: 'r', programmeName: 'Wild Rivers', amount: 5_000 }),
          inst({ prior: false, amount: 7_000 }),
        ],
      }),
    )
    expect(s.lines.map((l) => l.kind)).toEqual(['prior', 'current'])
    const prior = s.lines[0]!
    expect(prior.children.map((c) => c.name)).toEqual(['Wild Rivers', 'Youth Futures'])
    expect(prior.stillToPay).toBe(prior.children.reduce((n, c) => n + c.stillToPay, 0))
  })

  it('places core costs by schedule: actual to date, still to pay after', () => {
    const s = buildBalanceSummary(
      base({ costLines: [{ label: 'Rent', amount: 24_000, frequency: 'monthly', dueDate: null }] }),
    )
    // April–August have ended by 12 September; a month's share falls at the month end.
    // What is still to come is a fixed cost, so it is owed rather than projected.
    expect(s.lines[0]).toMatchObject({
      kind: 'core',
      actual: 10_000,
      projected: 0,
      stillToPay: 14_000,
    })
    // The 31 August share was scheduled before the 1 September reading: inside the balance.
    expect(s.sinceBalance!.core).toBe(0)
  })

  it('sets contingency aside as a percentage of the programme lines only', () => {
    const s = buildBalanceSummary(
      base({
        costLines: [{ label: 'Rent', amount: 12_000, frequency: 'monthly', dueDate: null }],
        programmeBudgets: new Map([
          ['a', 300_000],
          ['b', 100_000],
        ]),
        contingencyPercent: 5,
      }),
    )
    expect(s.contingency).toEqual({ percent: 5, amount: 20_000 })
    expect(s.lines.at(-1)).toMatchObject({ kind: 'contingency', projected: 20_000, actual: 0 })
  })

  it('flags a programme whose year passes its budget line, earlier grants included', () => {
    const s = buildBalanceSummary(
      base({
        instalments: [
          inst({ prior: true, amount: 30_000 }),
          inst({ prior: false, amount: 60_000 }),
        ],
        roundProgrammes: [rp({ budget: 40_000, awardedThisYear: 10_000 })],
        programmeBudgets: new Map([['warm', 100_000]]),
      }),
    )
    const warm = s.lines.find((l) => l.kind === 'current')!.children[0]!
    expect(warm.over).toBe(30_000 + 60_000 + 30_000 - 100_000)
  })

  it('still states what is owed without a balance, but no available figure', () => {
    const s = buildBalanceSummary(base({ balance: null, instalments: [inst({ amount: 5_000 })] }))
    expect(s.total.stillToPay).toBe(5_000)
    expect(s.sinceBalance).toBeNull()
    expect(s.deducted).toBeNull()
    expect(s.available).toBeNull()
  })

  it('agrees with the cash flow headroom once projection and contingency are set aside', () => {
    const input = base({
      costLines: [
        { label: 'Rent', amount: 24_000, frequency: 'monthly', dueDate: null },
        { label: 'Audit', amount: 6_000, frequency: 'one_off', dueDate: '2026-12-01' },
      ],
      // An older reading, so core costs and payments land on both sides of it.
      balance: { amount: 500_000, asAtDate: '2026-07-15' },
      instalments: [
        inst({ paid: true, day: '2026-09-05', amount: 2_000 }),
        inst({ paid: true, day: '2026-05-05', amount: 9_000 }),
        inst({ paid: false, day: '2026-10-01', amount: 30_000, prior: true }),
        inst({ paid: false, day: '2026-07-01', amount: 1_500 }), // overdue
      ],
      roundProgrammes: [rp({ budget: 50_000 })],
      programmeBudgets: new Map([['warm', 200_000]]),
      contingencyPercent: 2.5,
    })
    const s = buildBalanceSummary(input)
    const flow = buildCashFlow({
      fy: FY,
      today: TODAY,
      balance: input.balance,
      instalments: input.instalments.map((i) => ({ day: i.day, paid: i.paid, amount: i.amount })),
      costLines: input.costLines,
    })
    expect(s.sinceBalance).toEqual({ grants: 2_000, core: 4_000, total: 6_000 })
    expect(s.available).toBe(flow.headroom! - 50_000 - 5_000)
  })

  describe('income', () => {
    // Read 1 August, today 12 September. Quarterly lines land at the end of June,
    // September, December and March: June is inside the balance and has arrived (Actual);
    // September, December and March are after the reading and still to come (Projected).
    const reading = { amount: 100_000, asAtDate: '2026-08-01' }
    const pledge = {
      label: 'Pledge',
      amount: 8_000,
      frequency: 'quarterly',
      dueDate: null,
      fixed: true,
    }
    const appeal = {
      label: 'Appeal',
      amount: 4_000,
      frequency: 'one_off',
      dueDate: '2027-01-15',
      fixed: false,
    }

    it('is a line of its own, with Actual and Projected, and never in the total out', () => {
      const s = buildBalanceSummary(
        base({
          balance: reading,
          instalments: [inst({ amount: 10_000 })],
          incomeLines: [pledge, appeal],
        }),
      )
      const income = s.lines.at(-1)!
      expect(income).toMatchObject({
        kind: 'income',
        actual: 2_000,
        projected: 10_000,
        stillToPay: 0,
      })
      expect(income.children.map((c) => [c.name, c.fixed])).toEqual([
        ['Appeal', false],
        ['Pledge', true],
      ])
      expect(s.total).toEqual({ actual: 0, projected: 0, stillToPay: 10_000 })
    })

    it('adds Fixed income to Available, and Projected only to the second figure', () => {
      const s = buildBalanceSummary(
        base({
          balance: reading,
          instalments: [inst({ amount: 10_000 })],
          incomeLines: [pledge, appeal],
        }),
      )
      // Pledge after the reading: September, December, March = £6,000. June is in the
      // balance already and must not be counted twice.
      expect(s.income).toEqual({
        actual: 2_000,
        projected: 10_000,
        // The certainty split, over the whole year: Pledge is Fixed, Appeal is not.
        fixedTotal: 8_000,
        projectedTotal: 4_000,
        fixedToCome: 6_000,
        projectedToCome: 4_000,
      })
      expect(s.beforeIncome).toBe(90_000)
      expect(s.available).toBe(96_000)
      expect(s.availableWithProjected).toBe(100_000)
    })

    it('reads exactly as before with no income lines', () => {
      const s = buildBalanceSummary(base({ instalments: [inst({ amount: 10_000 })] }))
      expect(s.income).toBeNull()
      expect(s.available).toBe(s.beforeIncome)
      expect(s.availableWithProjected).toBe(s.available)
      expect(s.lines.some((l) => l.kind === 'income')).toBe(false)
    })

    it('agrees with the cash flow headroom, which counts every income line', () => {
      const input = base({
        balance: reading,
        costLines: [{ label: 'Rent', amount: 24_000, frequency: 'monthly', dueDate: null }],
        instalments: [
          inst({ paid: true, day: '2026-08-20', amount: 2_000 }),
          inst({ paid: false, day: '2026-11-01', amount: 30_000 }),
        ],
        incomeLines: [pledge, appeal],
        roundProgrammes: [rp({ budget: 50_000 })],
      })
      const s = buildBalanceSummary(input)
      const flow = buildCashFlow({
        fy: FY,
        today: TODAY,
        balance: input.balance,
        instalments: input.instalments.map((i) => ({ day: i.day, paid: i.paid, amount: i.amount })),
        costLines: input.costLines,
        incomeLines: input.incomeLines,
      })
      expect(s.availableWithProjected).toBe(flow.headroom! - 50_000)
    })
  })
})
