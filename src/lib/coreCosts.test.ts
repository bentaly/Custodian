import { describe, expect, it } from 'vitest'
import { costEntries, monthsOfYear, resolveFrequency, scheduleCoreCosts } from './coreCosts'
import { financialYear } from './financialYear'

const FY = financialYear(3, new Date('2026-09-12T12:00:00Z')) // 1 Apr 2026 – 31 Mar 2027

describe('monthsOfYear', () => {
  it('spans twelve months ending on their last days', () => {
    const months = monthsOfYear(FY)
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ key: '2026-04', start: '2026-04-01', end: '2026-04-30' })
    expect(months[10]!.end).toBe('2027-02-28')
    expect(months[11]).toEqual({ key: '2027-03', start: '2027-03-01', end: '2027-03-31' })
  })

  it('handles a calendar year', () => {
    const months = monthsOfYear(financialYear(12, new Date('2026-05-01T00:00:00Z')))
    expect(months.map((m) => m.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    )
  })
})

describe('resolveFrequency', () => {
  it('reads NULL as monthly — a row older than the column spreads evenly', () => {
    expect(resolveFrequency(null)).toBe('monthly')
    expect(resolveFrequency('one_off')).toBe('one_off')
  })
})

describe('costEntries', () => {
  it('splits a monthly line into twelve month-end shares that sum to the year exactly', () => {
    const entries = costEntries(
      { label: 'Rent', amount: 1000, frequency: 'monthly', dueDate: null },
      FY,
    )
    expect(entries).toHaveLength(12)
    expect(entries[0]).toEqual({ date: '2026-04-30', amount: 83.33 })
    // The remainder lands on the final month, as `buildSchedule` does for instalments.
    expect(entries[11]).toEqual({ date: '2027-03-31', amount: 83.37 })
    const pence = entries.reduce((s, e) => s + Math.round(e.amount * 100), 0)
    expect(pence).toBe(100_000)
  })

  it('places a one-off on its date', () => {
    expect(
      costEntries(
        { label: 'Audit', amount: 4800, frequency: 'one_off', dueDate: '2026-11-15' },
        FY,
      ),
    ).toEqual([{ date: '2026-11-15', amount: 4800 }])
  })

  it('clamps a one-off dated outside the year into it rather than losing it', () => {
    expect(
      costEntries({ label: 'x', amount: 10, frequency: 'one_off', dueDate: '2025-01-01' }, FY)[0]!
        .date,
    ).toBe(FY.start)
    expect(
      costEntries({ label: 'x', amount: 10, frequency: 'one_off', dueDate: '2030-01-01' }, FY)[0]!
        .date,
    ).toBe(FY.end)
  })

  it('puts an undated one-off at the year end, the latest it could fall', () => {
    expect(
      costEntries({ label: 'x', amount: 10, frequency: 'one_off', dueDate: null }, FY)[0]!.date,
    ).toBe(FY.end)
  })

  it('yields nothing for a zero line', () => {
    expect(costEntries({ label: 'x', amount: 0, frequency: 'monthly', dueDate: null }, FY)).toEqual(
      [],
    )
  })
})

describe('scheduleCoreCosts', () => {
  const lines = [
    { label: 'Rent', amount: 24_000, frequency: 'monthly', dueDate: null },
    { label: 'Audit', amount: 6_000, frequency: 'one_off', dueDate: '2026-12-01' },
    { label: null, amount: 1_200, frequency: null, dueDate: null },
  ]

  it('counts a month as spent only once it has ended', () => {
    // 12 September: April–August are over (5 months), September is still to come.
    const r = scheduleCoreCosts(lines, FY, '2026-09-12')
    expect(r.lines[0]).toMatchObject({
      name: 'Rent',
      perMonth: 2_000,
      toDate: 10_000,
      toCome: 14_000,
    })
    expect(r.lines[1]).toMatchObject({ frequency: 'one_off', dueDate: '2026-12-01', toDate: 0 })
    expect(r.lines[2]).toMatchObject({ name: 'Core costs', frequency: 'monthly', toDate: 500 })
    expect(r.total).toBe(31_200)
    expect(r.toDate + r.toCome).toBe(r.total)
    expect(r.perMonth).toBe(2_100)
    expect(r.oneOff).toBe(6_000)
  })

  it('counts the month-end share on the month-end day itself', () => {
    expect(scheduleCoreCosts(lines, FY, '2026-09-30').lines[0]!.toDate).toBe(12_000)
  })

  it('has spent everything by the year end', () => {
    const r = scheduleCoreCosts(lines, FY, FY.end)
    expect(r.toCome).toBe(0)
    expect(r.toDate).toBe(31_200)
  })
})
