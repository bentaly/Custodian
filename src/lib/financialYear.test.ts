import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FY_END_MONTH,
  financialYear,
  financialYearRange,
  isFyEndMonth,
  shiftFinancialYear,
} from './financialYear'

const on = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('financialYear', () => {
  it('runs April to March for the default 31 March year end', () => {
    expect(financialYear(3, on('2026-08-30'))).toEqual({
      start: '2026-04-01',
      end: '2027-03-31',
      label: '2026/27',
    })
  })

  it('puts a date before the year end in the year that ends this calendar year', () => {
    // 15 Feb 2027 is still inside the year that started 1 Apr 2026.
    expect(financialYear(3, on('2027-02-15'))).toEqual({
      start: '2026-04-01',
      end: '2027-03-31',
      label: '2026/27',
    })
  })

  it('rolls over on the day after the year end, not before it', () => {
    expect(financialYear(3, on('2027-03-31')).label).toBe('2026/27')
    expect(financialYear(3, on('2027-04-01')).label).toBe('2027/28')
  })

  it('labels a December year end as the calendar year, not a straddle', () => {
    expect(financialYear(12, on('2026-08-30'))).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
      label: '2026',
    })
  })

  it('handles a leap-year February year end', () => {
    expect(financialYear(2, on('2028-01-10')).end).toBe('2028-02-29')
    expect(financialYear(2, on('2027-01-10')).end).toBe('2027-02-28')
  })

  it('handles a 30-day year end', () => {
    expect(financialYear(9, on('2026-08-30'))).toEqual({
      start: '2025-10-01',
      end: '2026-09-30',
      label: '2025/26',
    })
  })

  it('falls back to the default for a nonsense end month', () => {
    expect(financialYear(0, on('2026-08-30'))).toEqual(
      financialYear(DEFAULT_FY_END_MONTH, on('2026-08-30')),
    )
    expect(financialYear(13, on('2026-08-30'))).toEqual(
      financialYear(DEFAULT_FY_END_MONTH, on('2026-08-30')),
    )
  })

  it('treats the boundary in UTC, so a late-evening London award does not slip a year', () => {
    // 31 March 2027, 23:30 in London is 22:30 UTC — still the old financial year.
    expect(financialYear(3, new Date('2027-03-31T22:30:00Z')).label).toBe('2026/27')
  })
})

describe('shiftFinancialYear', () => {
  it('steps back a year', () => {
    expect(shiftFinancialYear(3, -1, on('2026-08-30')).label).toBe('2025/26')
  })

  it('steps forward a year', () => {
    expect(shiftFinancialYear(3, 1, on('2026-08-30')).label).toBe('2027/28')
  })

  it('steps a calendar year cleanly', () => {
    expect(shiftFinancialYear(12, -1, on('2026-08-30'))).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
      label: '2025',
    })
  })
})

describe('isFyEndMonth', () => {
  it('accepts 1 through 12 and nothing else', () => {
    expect(isFyEndMonth(1)).toBe(true)
    expect(isFyEndMonth(12)).toBe(true)
    expect(isFyEndMonth(0)).toBe(false)
    expect(isFyEndMonth(13)).toBe(false)
    expect(isFyEndMonth(3.5)).toBe(false)
    expect(isFyEndMonth('3')).toBe(false)
    expect(isFyEndMonth(null)).toBe(false)
  })
})

describe('financialYearRange', () => {
  it('reads as a pair of full dates', () => {
    expect(financialYearRange(financialYear(3, on('2026-08-30')))).toBe(
      '1 April 2026 – 31 March 2027',
    )
  })
})
