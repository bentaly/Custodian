import { describe, expect, it } from 'vitest'
import { coerceAmount } from './canonical'

// The ask drives every budget meter and the assessment, so an answer that is not plainly
// one amount reads as nothing: the application lands without it, flagged, and a person
// types it in. The old reader fused every digit in the answer into one number.

describe('coerceAmount', () => {
  it('reads one amount, with or without currency, commas and pence', () => {
    expect(coerceAmount('15000')).toBe('15000')
    expect(coerceAmount('£15,000')).toBe('15000')
    expect(coerceAmount('£15,000.50')).toBe('15000.5')
    expect(coerceAmount('About £24,000 in total')).toBe('24000')
    expect(coerceAmount('approx 40')).toBe('40')
  })

  it('reads a written scale', () => {
    expect(coerceAmount('£15k')).toBe('15000')
    expect(coerceAmount('£1.5m')).toBe('1500000')
    expect(coerceAmount('15 thousand')).toBe('15000')
    expect(coerceAmount('2.2 million')).toBe('2200000')
  })

  it('reads nothing from a range, several numbers or words', () => {
    expect(coerceAmount('£2,500-5,000 per year')).toBe('')
    expect(coerceAmount('3 staff at £20k')).toBe('')
    expect(coerceAmount('£25,000 over 3 years')).toBe('')
    expect(coerceAmount('about fifteen thousand pounds')).toBe('')
    expect(coerceAmount('TBC')).toBe('')
  })

  it('reads nothing from a share or a malformed number', () => {
    expect(coerceAmount('50%')).toBe('')
    expect(coerceAmount('10 per cent')).toBe('')
    expect(coerceAmount('25,00')).toBe('')
  })

  it('does not take a word beginning with a scale letter as a scale', () => {
    expect(coerceAmount('500 meals')).toBe('500')
    expect(coerceAmount('40 kids')).toBe('40')
  })
})
