import { describe, expect, it } from 'vitest'
import { roundFinancialYear, roundYearIsAmbiguous, roundYearOptions } from './roundYear'

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
  it('offers one year for a round inside a single year, flagged as the default', () => {
    const opts = roundYearOptions({ openedAt: d('2026-05-01'), closedAt: d('2026-07-01') }, MARCH)
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({ label: '2026/27', isDefault: true })
    expect(
      roundYearIsAmbiguous({ openedAt: d('2026-05-01'), closedAt: d('2026-07-01') }, MARCH),
    ).toBe(false)
  })

  it('offers both ends for a round that straddles a year end, closing year default', () => {
    const round = { openedAt: d('2027-02-01'), closedAt: d('2027-06-01') }
    const opts = roundYearOptions(round, MARCH)
    expect(opts.map((o) => o.label)).toEqual(['2026/27', '2027/28'])
    expect(opts.find((o) => o.isDefault)?.label).toBe('2027/28')
    expect(roundYearIsAmbiguous(round, MARCH)).toBe(true)
  })

  it('offers only the two ENDS, never the years between', () => {
    // An eighteen-month round is a data-entry mistake far more often than a real shape,
    // and offering the middle year would dress that up as something we support.
    const opts = roundYearOptions({ openedAt: d('2026-05-01'), closedAt: d('2027-11-01') }, MARCH)
    expect(opts.map((o) => o.label)).toEqual(['2026/27', '2027/28'])
  })

  it('asks nothing while the round is still half-dated', () => {
    expect(roundYearOptions({ openedAt: d('2026-05-01'), closedAt: null }, MARCH)).toHaveLength(1)
    expect(roundYearOptions({ openedAt: null, closedAt: null }, MARCH)).toHaveLength(1)
  })

  it('follows the foundation’s own year end', () => {
    // On a calendar year the same dates no longer straddle anything.
    const round = { openedAt: d('2027-02-01'), closedAt: d('2027-06-01') }
    expect(roundYearIsAmbiguous(round, 12)).toBe(false)
    expect(roundYearIsAmbiguous(round, MARCH)).toBe(true)
  })
})
