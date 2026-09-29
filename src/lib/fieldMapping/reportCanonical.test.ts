import { describe, expect, it } from 'vitest'
import { coerceCount } from './reportCanonical'

// The report's impact figure is summed into Insights as fact, so an answer that is not
// plainly one whole number reads as nothing (the report still lands and says so).

describe('coerceCount', () => {
  it('reads one whole number, with or without words around it', () => {
    expect(coerceCount('130')).toBe('130')
    expect(coerceCount('~130 young people')).toBe('130')
    expect(coerceCount('about 60')).toBe('60')
    expect(coerceCount('We supported 391 households.')).toBe('391')
  })

  it('reads thousands separators', () => {
    expect(coerceCount('2,500 households')).toBe('2500')
    expect(coerceCount('1,250,000')).toBe('1250000')
  })

  it('reads nothing from an answer with no number', () => {
    expect(coerceCount('Not counted yet')).toBe('')
    expect(coerceCount('N/A')).toBe('')
  })

  it('reads nothing from a range or two numbers', () => {
    expect(coerceCount('60-70')).toBe('')
    expect(coerceCount('between 60 and 70')).toBe('')
    expect(coerceCount('Year 1: 40, year 2: 55')).toBe('')
  })

  it('reads nothing from a decimal, a scale or a share', () => {
    expect(coerceCount('12.5')).toBe('')
    expect(coerceCount('1.2k')).toBe('')
    expect(coerceCount('3k people')).toBe('')
    expect(coerceCount('2 m')).toBe('')
    expect(coerceCount('45%')).toBe('')
    expect(coerceCount('45 per cent')).toBe('')
  })

  it('reads nothing from misplaced commas', () => {
    expect(coerceCount('25,00')).toBe('')
  })
})
