import { describe, expect, it } from 'vitest'
import { cadenceMonths, scheduleTermMonths, termLabel } from './awardSchedule'

describe('scheduleTermMonths', () => {
  // The rule this function exists for. Two annual payments are a TWO-year grant: the
  // second instalment pays for the year that follows it, so the grant runs on for
  // twelve months after the last payment date. Measuring the gap between the first
  // date and the last returns 12 months here and is wrong every time.
  it('counts what the instalments cover, not the gap between them', () => {
    expect(scheduleTermMonths(2, cadenceMonths('yearly'))).toBe(24)
  })

  it('reads a three-year plan as three years', () => {
    expect(scheduleTermMonths(3, cadenceMonths('yearly'))).toBe(36)
  })

  // The cases that must NOT read as multi-year: more instalments inside one year is a
  // payment rhythm, not a longer grant.
  it('keeps a year of sub-annual instalments at one year', () => {
    expect(scheduleTermMonths(2, cadenceMonths('biannual'))).toBe(12)
    expect(scheduleTermMonths(4, cadenceMonths('quarterly'))).toBe(12)
    expect(scheduleTermMonths(12, cadenceMonths('monthly'))).toBe(12)
  })

  it('reads a single payment as a single year', () => {
    expect(scheduleTermMonths(1, cadenceMonths('yearly'))).toBe(12)
  })
})

describe('termLabel', () => {
  it('says years where the months divide', () => {
    expect(termLabel(12)).toBe('1 year')
    expect(termLabel(36)).toBe('3 years')
  })

  it('falls back to months where they do not', () => {
    expect(termLabel(18)).toBe('18 months')
  })
})
