import { describe, expect, it } from 'vitest'
import {
  carriedCommitmentForYear,
  isSuggestedFirstYear,
  resolveFirstYearAmount,
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

  it('counts instalments PAID inside the year, cancelled or not, and none paid outside it', () => {
    // Arete, 2026-09-30: £10,170 paid this year and £9,729.50 still to pay on earlier
    // rounds' grants. Counting only the unpaid half read £9,729.50 in Settings against
    // Finance's £19,899.50, and shrank with every payment made.
    expect(
      carriedCommitmentForYear(
        [
          { dueDate: '2026-07-07', paidDate: '2026-07-07', amount: 10_170 },
          { dueDate: '2026-12-05', amount: 9_729.5 },
          { dueDate: '2026-05-01', paidDate: '2026-05-01', amount: 500, awardStatus: 'cancelled' },
          { dueDate: '2026-02-01', paidDate: '2026-02-01', amount: 7_000 },
          { dueDate: '2027-05-01', paidDate: '2027-05-01', amount: 7_000 },
        ],
        FY,
      ),
    ).toBe(20_399.5)
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
