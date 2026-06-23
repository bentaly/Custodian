import { describe, expect, it } from 'vitest'
import {
  decileStats,
  formatDecileRange,
  looksLikePostcode,
  nationFromGssCode,
} from './types'

describe('looksLikePostcode', () => {
  it('accepts full postcodes with and without a space', () => {
    expect(looksLikePostcode('BD1 1AA')).toBe(true)
    expect(looksLikePostcode('bd11aa')).toBe(true)
    expect(looksLikePostcode('SW1A 1AA')).toBe(true)
    expect(looksLikePostcode('  EH1 1RE  ')).toBe(true)
    expect(looksLikePostcode('BT79 7LP')).toBe(true)
  })

  it('rejects place names and bare outcodes', () => {
    expect(looksLikePostcode('Potters Bar')).toBe(false)
    expect(looksLikePostcode('London')).toBe(false)
    expect(looksLikePostcode('BD1')).toBe(false) // outcode → handled as a place
  })
})

describe('nationFromGssCode', () => {
  it('maps the leading letter to a nation', () => {
    expect(nationFromGssCode('E01011375')).toBe('england')
    expect(nationFromGssCode('W01002019')).toBe('wales')
    expect(nationFromGssCode('S01014714')).toBe('scotland')
    expect(nationFromGssCode('N21000500')).toBe('northern_ireland')
    // NI's legacy SOA codes start with a digit (used by NIMDM2017 / postcodes.io lsoa11).
    expect(nationFromGssCode('95AA01S1')).toBe('northern_ireland')
    expect(nationFromGssCode('?')).toBeNull()
  })
})

describe('decileStats', () => {
  it('summarises a single area (postcode case)', () => {
    const s = decileStats([3])
    expect(s).toMatchObject({ count: 1, min: 3, max: 3, median: 3 })
    expect(s.histogram[2]).toBe(1)
  })

  it('summarises a spread across areas', () => {
    const s = decileStats([1, 1, 2, 4, 6])
    expect(s).toMatchObject({ count: 5, min: 1, max: 6, median: 2 })
    expect(s.histogram[0]).toBe(2) // two areas in decile 1
    expect(s.histogram[3]).toBe(1) // one in decile 4
  })
})

describe('formatDecileRange', () => {
  it('shows a single decile when min === max', () => {
    expect(formatDecileRange({ min: 3, max: 3 })).toBe('Decile 3')
  })
  it('shows a range otherwise', () => {
    expect(formatDecileRange({ min: 2, max: 6 })).toBe('Decile 2–6')
  })
})
