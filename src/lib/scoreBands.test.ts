import { describe, expect, it } from 'vitest'
import { SCORE_BANDS, scoreBandFor, scoreBandKey } from './scoreBands'
import { SCORE_BAND, bandForScore } from '../components/ui/tokens'

// The one property the filter exists to have: the rows a band returns are the rows
// wearing that band's colour. The four old options (90+ / 80–89 / 70–79 / Below 70)
// cut the scale in places nothing else in the app cuts it, so "Below 70" returned a
// mixture of amber and red rows.

describe('score bands', () => {
  it('cover the whole scale with no gap and no overlap', () => {
    const covered = new Set<number>()
    for (const band of SCORE_BANDS) {
      for (let s = band.min; s <= band.max; s++) {
        expect(covered.has(s)).toBe(false)
        covered.add(s)
      }
    }
    expect(covered.size).toBe(101) // 0…100
  })

  it('colour every score in a band the same as the band', () => {
    for (const band of SCORE_BANDS) {
      for (let s = band.min; s <= band.max; s++) {
        expect(scoreBandKey(s)).toBe(band.value)
        expect(bandForScore(s)).toBe(SCORE_BAND[band.value])
      }
    }
  })

  it('band a criterion out of 10 on the same proportions', () => {
    expect(scoreBandKey(7, 10)).toBe('good')
    expect(scoreBandKey(6.9, 10)).toBe('fair')
    expect(scoreBandKey(4, 10)).toBe('fair')
    expect(scoreBandKey(3.9, 10)).toBe('poor')
  })

  it('resolve a band from a search param, and nothing from a stale one', () => {
    expect(scoreBandFor('good')?.min).toBe(70)
    // A URL bookmarked while the filter still offered 90+ / 80–89 / 70–79.
    expect(scoreBandFor('90plus')).toBeUndefined()
    expect(scoreBandFor(undefined)).toBeUndefined()
  })
})
