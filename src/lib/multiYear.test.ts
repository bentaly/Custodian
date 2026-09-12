import { describe, expect, it } from 'vitest'
import {
  carriedCommitmentForYear,
  isSuggestedFirstYear,
  resolveFirstYearAmount,
  rollUpCash,
  suggestFirstYearAmount,
} from './multiYear'

const FY = { start: '2026-04-01', end: '2027-03-31' }

describe('suggestFirstYearAmount', () => {
  it('divides by the duration for a multi-year grant', () => {
    expect(suggestFirstYearAmount(60_000, 3)).toBe(20_000)
  })

  it('is the whole ask for a single-year grant, and for one with no duration set', () => {
    expect(suggestFirstYearAmount(60_000, 1)).toBe(60_000)
    expect(suggestFirstYearAmount(60_000, null)).toBe(60_000)
  })

  it('never suggests more than the ask, whatever the duration says', () => {
    // Neither is reachable through the round validator; both are reachable over the wire,
    // and a drawdown larger than the grant would eat a round's budget twice over.
    expect(suggestFirstYearAmount(60_000, 0)).toBe(60_000)
    expect(suggestFirstYearAmount(60_000, -3)).toBe(60_000)
  })

  it('rounds to whole pounds', () => {
    expect(suggestFirstYearAmount(10_000, 3)).toBe(3_333)
  })
})

describe('resolveFirstYearAmount', () => {
  const ask = { amountRequested: 48_000, grantDurationYears: 2 }

  it('falls back to the suggestion while nobody has stated a figure', () => {
    expect(resolveFirstYearAmount({ ...ask, firstYearAmount: null })).toBe(24_000)
  })

  it('honours a stated figure over the suggestion', () => {
    // The case the whole feature exists for: £48,000 paid every four months over sixteen
    // months puts three of its four instalments inside the first financial year, which is
    // £36,000 and not the £24,000 the division reaches.
    expect(resolveFirstYearAmount({ ...ask, firstYearAmount: 36_000 })).toBe(36_000)
  })

  it('honours a stated ZERO, which is not the same as nobody having said', () => {
    // A grant whose first payment falls after this year end draws nothing from this round.
    expect(resolveFirstYearAmount({ ...ask, firstYearAmount: 0 })).toBe(0)
    expect(isSuggestedFirstYear(0)).toBe(false)
    expect(isSuggestedFirstYear(null)).toBe(true)
  })

  it('clamps a stated figure to the ask', () => {
    expect(resolveFirstYearAmount({ ...ask, firstYearAmount: 99_000 })).toBe(48_000)
    expect(resolveFirstYearAmount({ ...ask, firstYearAmount: -5 })).toBe(0)
  })
})

describe('carriedCommitmentForYear', () => {
  it('counts instalments falling due on or before the year end', () => {
    expect(
      carriedCommitmentForYear(
        [
          { dueDate: '2026-06-01', amount: 30_000 },
          { dueDate: '2027-06-01', amount: 30_000 },
        ],
        FY,
      ),
    ).toBe(30_000)
  })

  it('counts an instalment that fell due in an EARLIER year and was never paid', () => {
    // The bug this was written against. Money owed since last March is still money that
    // has to leave the account this year, and a lower bound on the due date drops it —
    // understating the one figure the function exists to state.
    expect(carriedCommitmentForYear([{ dueDate: '2026-03-01', amount: 30_000 }], FY)).toBe(30_000)
  })

  it('counts undated instalments', () => {
    // Money with no date is still owed. Dropping it would make a foundation that has not
    // scheduled a grant look like it had nothing to pay.
    expect(carriedCommitmentForYear([{ dueDate: null, amount: 12_000 }], FY)).toBe(12_000)
  })

  it('excludes cancelled awards', () => {
    expect(
      carriedCommitmentForYear(
        [
          { dueDate: '2026-06-01', amount: 30_000, awardStatus: 'cancelled' },
          { dueDate: '2026-06-01', amount: 10_000, awardStatus: 'active' },
        ],
        FY,
      ),
    ).toBe(10_000)
  })
})

describe('rollUpCash', () => {
  const programmes = new Map([['p1', { name: 'Youth Futures', colour: '#aabbcc' }]])

  it('derives free-to-give from the budget less what earlier years promised', () => {
    const out = rollUpCash(
      [{ programmeId: 'p1', amount: 500_000, carriedCommitment: null }],
      programmes,
      new Map([['p1', 30_000]]),
      new Map([['p1', 56_000]]),
    )
    expect(out.lines[0]).toMatchObject({
      name: 'Youth Futures',
      budget: 500_000,
      promised: 30_000,
      promisedDerived: 30_000,
      free: 470_000,
      allocated: 56_000,
      unallocated: 414_000,
      overridden: false,
    })
    expect(out.free).toBe(470_000)
  })

  it('prefers a stated figure and says it was stated', () => {
    const out = rollUpCash(
      [{ programmeId: 'p1', amount: 500_000, carriedCommitment: 35_000 }],
      programmes,
      new Map([['p1', 30_000]]),
      new Map(),
    )
    expect(out.lines[0]).toMatchObject({
      promised: 35_000,
      promisedDerived: 30_000,
      free: 465_000,
      overridden: true,
    })
  })

  it('does not call a stated figure equal to the derived one an override', () => {
    // Both sides are numerics parsed out of Postgres; a penny-identical restatement must
    // not light up the "buffer applied" note.
    const out = rollUpCash(
      [{ programmeId: 'p1', amount: 500_000, carriedCommitment: 30_000 }],
      programmes,
      new Map([['p1', 30_000]]),
      new Map(),
    )
    expect(out.lines[0]!.overridden).toBe(false)
  })

  it('floors free-to-give at zero when earlier years owe more than the budget', () => {
    const out = rollUpCash(
      [{ programmeId: 'p1', amount: 20_000, carriedCommitment: null }],
      programmes,
      new Map([['p1', 30_000]]),
      new Map(),
    )
    expect(out.lines[0]!.free).toBe(0)
  })

  it('leaves core-cost lines out entirely', () => {
    // They have no grants behind them, so nothing carries forward and no round allocates
    // to them. They stay in the commitment view, which is where they are budgeted.
    const out = rollUpCash(
      [
        { programmeId: null, amount: 60_000, carriedCommitment: null },
        { programmeId: 'p1', amount: 100_000, carriedCommitment: null },
      ],
      programmes,
      new Map(),
      new Map(),
    )
    expect(out.lines).toHaveLength(1)
    expect(out.budget).toBe(100_000)
  })
})

/**
 * The red "allocated to rounds — £X over" line on Settings → Annual budget, which reads
 * `free` and `allocated` straight off this rollup.
 */
describe('rollUpCash — rounds allocated against what is free', () => {
  const names = new Map([['food', { name: 'Community Food', colour: null }]])

  it('reports a round allocation that ignores earlier years as over by exactly those years', () => {
    // A £175,000 programme whose rounds were given the whole £175,000, with £18,000 still
    // owed this year on grants decided last year.
    const r = rollUpCash(
      [{ programmeId: 'food', amount: 175_000, carriedCommitment: null }],
      names,
      new Map([['food', 18_000]]),
      new Map([['food', 175_000]]),
    )
    expect(r.lines[0]).toMatchObject({ free: 157_000, allocated: 175_000, unallocated: -18_000 })
  })

  it('clears once a finance lead states that the earlier money is not due this year', () => {
    const r = rollUpCash(
      [{ programmeId: 'food', amount: 175_000, carriedCommitment: 0 }],
      names,
      new Map([['food', 18_000]]),
      new Map([['food', 175_000]]),
    )
    expect(r.lines[0]).toMatchObject({ free: 175_000, unallocated: 0, overridden: true })
  })

  it('is not over when the rounds leave room', () => {
    const r = rollUpCash(
      [{ programmeId: 'food', amount: 175_000, carriedCommitment: null }],
      names,
      new Map([['food', 18_000]]),
      new Map([['food', 150_000]]),
    )
    expect(r.lines[0]!.unallocated).toBe(7_000)
  })

  it('treats a programme no round funds as nothing allocated', () => {
    const r = rollUpCash(
      [{ programmeId: 'food', amount: 10_000, carriedCommitment: null }],
      names,
      new Map(),
      new Map(),
    )
    expect(r.lines[0]).toMatchObject({ free: 10_000, allocated: 0, unallocated: 10_000 })
  })
})
