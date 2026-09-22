import { describe, expect, it } from 'vitest'
import { roundFinancialYear, roundYearOptions } from './roundYear'

// 31 March, the commonest UK charity year end: 2026/27 runs 1 Apr 2026 – 31 Mar 2027.
const MARCH = 3
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('roundFinancialYear', () => {
  it('takes the year the round CLOSES in', () => {
    // Decisions are made at close, and that is when the money is committed.
    const fy = roundFinancialYear(
      { financialYearStart: null, openedAt: d('2026-05-01'), closedAt: d('2026-07-01') },
      MARCH,
    )
    expect(fy.label).toBe('2026/27')
  })

  it('places a round that closes after the year end in the NEW year', () => {
    const fy = roundFinancialYear(
      { financialYearStart: null, openedAt: d('2027-02-01'), closedAt: d('2027-06-01') },
      MARCH,
    )
    expect(fy.label).toBe('2027/28')
  })

  it('honours a stored answer over the closing date', () => {
    // The straddling case: the foundation said this round spends the OLD year's money.
    const fy = roundFinancialYear(
      {
        financialYearStart: '2026-04-01',
        openedAt: d('2027-02-01'),
        closedAt: d('2027-06-01'),
      },
      MARCH,
    )
    expect(fy.label).toBe('2026/27')
  })

  it('honours a stored answer for a round that closes on the year end and pays after it', () => {
    // The case the whole control exists for: applications from January, closing 31 March,
    // grants paid in May. Every date sits in 2025/26; every pound leaves in 2026/27.
    const fy = roundFinancialYear(
      {
        financialYearStart: '2026-04-01',
        openedAt: d('2026-01-12'),
        closedAt: d('2026-03-31'),
      },
      MARCH,
    )
    expect(fy.label).toBe('2026/27')
  })

  it('re-derives a stored answer through the CURRENT year-end month', () => {
    // A foundation that moves its year end must not leave old rounds pointing at bounds
    // that no longer exist; the year that start date falls in is still the year they meant.
    const fy = roundFinancialYear(
      { financialYearStart: '2026-04-01', openedAt: null, closedAt: null },
      12,
    )
    expect(fy.label).toBe('2026')
  })

  it('falls back to the opening date, then to today', () => {
    expect(
      roundFinancialYear(
        { financialYearStart: null, openedAt: d('2026-05-01'), closedAt: null },
        MARCH,
      ).label,
    ).toBe('2026/27')
    expect(
      roundFinancialYear(
        { financialYearStart: null, openedAt: null, closedAt: null },
        MARCH,
        d('2026-05-01'),
      ).label,
    ).toBe('2026/27')
  })
})

describe('roundYearOptions', () => {
  it('offers the closing year and the one after it, closing year default', () => {
    // A round decides and then pays, so those are the two years the money can leave in.
    const opts = roundYearOptions({ openedAt: d('2026-05-01'), closedAt: d('2026-07-01') }, MARCH)
    expect(opts.map((o) => o.label)).toEqual(['2026/27', '2027/28'])
    expect(opts.map((o) => o.relation)).toEqual(['closes', 'after'])
    expect(opts.find((o) => o.isDefault)?.label).toBe('2026/27')
  })

  it('offers the year after for a round closing ON the year end', () => {
    // The foundation that closes 31 March and pays in May. Under the old rule this round
    // got a single option, and it was the wrong one, so the round could not be fixed.
    const opts = roundYearOptions({ openedAt: d('2026-01-12'), closedAt: d('2026-03-31') }, MARCH)
    expect(opts.map((o) => o.label)).toEqual(['2025/26', '2026/27'])
    expect(opts.find((o) => o.isDefault)?.label).toBe('2025/26')
  })

  it('adds the opening year for a round that straddles a year end', () => {
    // Three real answers: last year's underspend, the year it closes in, or the next.
    const round = { openedAt: d('2027-02-01'), closedAt: d('2027-06-01') }
    const opts = roundYearOptions(round, MARCH)
    expect(opts.map((o) => o.label)).toEqual(['2026/27', '2027/28', '2028/29'])
    expect(opts.map((o) => o.relation)).toEqual(['opens', 'closes', 'after'])
    expect(opts.find((o) => o.isDefault)?.label).toBe('2027/28')
  })

  it('offers only the two ENDS and the year after, never the years between', () => {
    // An eighteen-month round is a data-entry mistake far more often than a real shape,
    // and offering the middle year would dress that up as something we support.
    const opts = roundYearOptions({ openedAt: d('2026-05-01'), closedAt: d('2027-11-01') }, MARCH)
    expect(opts.map((o) => o.label)).toEqual(['2026/27', '2027/28', '2028/29'])
  })

  it('still offers a choice while the round is half-dated', () => {
    expect(
      roundYearOptions({ openedAt: d('2026-05-01'), closedAt: null }, MARCH).map((o) => o.label),
    ).toEqual(['2026/27', '2027/28'])
    expect(
      roundYearOptions({ openedAt: null, closedAt: null }, MARCH, d('2026-05-01')).map(
        (o) => o.label,
      ),
    ).toEqual(['2026/27', '2027/28'])
  })

  it('follows the foundation’s own year end', () => {
    // On a calendar year the same dates no longer straddle anything, so the opening year
    // drops out and only the pay-this-year-or-next pair is left.
    const round = { openedAt: d('2027-02-01'), closedAt: d('2027-06-01') }
    expect(roundYearOptions(round, 12).map((o) => o.label)).toEqual(['2027', '2028'])
    expect(roundYearOptions(round, MARCH).map((o) => o.label)).toEqual([
      '2026/27',
      '2027/28',
      '2028/29',
    ])
  })

  it('flags the default as the year an unanswered round is actually metered in', () => {
    // The two must never drift: the dialog pre-selects the flagged option, and a round
    // saved without touching it keeps NULL and is placed by `roundFinancialYear`.
    for (const round of [
      { openedAt: d('2026-01-12'), closedAt: d('2026-03-31') },
      { openedAt: d('2027-02-01'), closedAt: d('2027-06-01') },
      { openedAt: d('2026-05-01'), closedAt: null },
    ]) {
      const flagged = roundYearOptions(round, MARCH).find((o) => o.isDefault)!
      const derived = roundFinancialYear({ ...round, financialYearStart: null }, MARCH)
      expect(flagged.start).toBe(derived.start)
    }
  })
})
