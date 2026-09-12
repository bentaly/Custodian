import { describe, expect, it } from 'vitest'
import { annualFromForm, costTimingProblem, formAmount, storedTiming } from './coreCosts'
import { financialYear } from './financialYear'

/**
 * The save half of core-cost timing: what `saveAnnualBudget` stores, what it refuses, and
 * the per-month ↔ year conversion the Settings form does before it ever gets there.
 */

const FY = financialYear(3, new Date('2026-09-12T12:00:00Z')) // 1 Apr 2026 – 31 Mar 2027
const cost = (over: Partial<Parameters<typeof storedTiming>[0]> = {}) => ({
  programmeId: null,
  label: 'Audit',
  amount: 6_000,
  frequency: 'one_off',
  dueDate: '2026-12-01',
  ...over,
})

describe('storedTiming', () => {
  it('stores nothing on a programme line, whatever arrives', () => {
    expect(storedTiming(cost({ programmeId: 'p', frequency: 'one_off' }))).toEqual({
      frequency: null,
      dueDate: null,
    })
  })

  it('never stores NULL frequency on a cost line — an absent one is monthly', () => {
    expect(storedTiming(cost({ frequency: null, dueDate: null }))).toEqual({
      frequency: 'monthly',
      dueDate: null,
    })
    expect(storedTiming(cost({ frequency: undefined }))).toMatchObject({ frequency: 'monthly' })
  })

  it('drops a date left behind by a line switched to monthly', () => {
    expect(storedTiming(cost({ frequency: 'monthly', dueDate: '2026-12-01' }))).toEqual({
      frequency: 'monthly',
      dueDate: null,
    })
  })

  it('keeps a one-off date, and stores a blank one as NULL', () => {
    expect(storedTiming(cost())).toEqual({ frequency: 'one_off', dueDate: '2026-12-01' })
    expect(storedTiming(cost({ dueDate: '' })).dueDate).toBeNull()
  })
})

describe('costTimingProblem', () => {
  it('passes a dated one-off and any monthly line', () => {
    expect(
      costTimingProblem([cost(), cost({ frequency: 'monthly', dueDate: null })], FY),
    ).toBeNull()
  })

  it('refuses a one-off with no date, by name', () => {
    expect(costTimingProblem([cost({ dueDate: null })], FY)).toBe('Audit needs a date.')
    expect(costTimingProblem([cost({ dueDate: '', label: '  ' })], FY)).toBe(
      'The one-off cost needs a date.',
    )
  })

  it('refuses a one-off dated outside the year, and accepts both boundary days', () => {
    expect(costTimingProblem([cost({ dueDate: '2026-03-31' })], FY)).toBe(
      'Audit is dated outside this financial year.',
    )
    expect(costTimingProblem([cost({ dueDate: '2027-04-01' })], FY)).toMatch(/outside/)
    expect(costTimingProblem([cost({ dueDate: FY.start })], FY)).toBeNull()
    expect(costTimingProblem([cost({ dueDate: FY.end })], FY)).toBeNull()
  })

  it('ignores a zero line, which is not saved, and a programme line, which has no timing', () => {
    expect(costTimingProblem([cost({ amount: 0, dueDate: null })], FY)).toBeNull()
    expect(costTimingProblem([cost({ programmeId: 'p', dueDate: null })], FY)).toBeNull()
  })
})

describe('formAmount / annualFromForm', () => {
  it('shows a monthly line per month and saves the year', () => {
    const shown = formAmount(24_000, 'monthly', 12)
    expect(shown).toEqual({ typed: '2000', loadedAnnual: 24_000 })
    expect(annualFromForm('2000', 'monthly', 12, null)).toBe(24_000)
  })

  it('saves an UNTOUCHED monthly line exactly as loaded, not twelve rounded shares', () => {
    const shown = formAmount(50_000, 'monthly', 12)
    expect(shown.typed).toBe('4166.67')
    expect(annualFromForm(shown.typed, 'monthly', 12, shown.loadedAnnual)).toBe(50_000)
    // Once edited, the typed monthly figure is the truth — and twelve of it is the year.
    expect(annualFromForm('4166.67', 'monthly', 12, null)).toBe(50_000.04)
  })

  it('passes a one-off through untouched', () => {
    expect(formAmount(4_800, 'one_off', 12)).toEqual({ typed: '4800', loadedAnnual: null })
    expect(annualFromForm('4800', 'one_off', 12, null)).toBe(4_800)
  })

  it('reads blank, junk and negative figures as nothing', () => {
    for (const typed of ['', 'abc', '-50']) {
      expect(annualFromForm(typed, 'monthly', 12, null)).toBe(0)
      expect(annualFromForm(typed, 'one_off', 12, null)).toBe(0)
    }
  })

  it('never multiplies float noise into the year', () => {
    expect(annualFromForm('0.1', 'monthly', 12, null)).toBe(1.2)
  })
})
