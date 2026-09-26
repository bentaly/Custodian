import { describe, expect, it } from 'vitest'
import { locationFacet } from './facets'
import { NO_LOCATION } from './deprivation/types'

describe('locationFacet', () => {
  it('offers districts, county areas and unmatched text, each with its kind', () => {
    expect(
      locationFacet([
        { value: 'Oldham', kind: 'district', count: 2 },
        { value: 'Merseyside', kind: 'county', count: 1 },
        { value: 'Across the north', kind: 'unmatched', count: 1 },
      ]),
    ).toEqual([
      { value: 'Across the north', label: 'Across the north', count: 1, kind: 'unmatched' },
      { value: 'Merseyside', label: 'Merseyside', count: 1, kind: 'county' },
      { value: 'Oldham', label: 'Oldham', count: 2, kind: 'district' },
    ])
  })

  // The Region pill offers these already; here they would be the same option twice.
  it('leaves out a region-level match', () => {
    expect(
      locationFacet([
        { value: null, kind: 'region', count: 3 },
        { value: 'Oldham', kind: 'district', count: 1 },
      ]).map((o) => o.value),
    ).toEqual(['Oldham'])
  })

  it('pins the grants with no location at all last, as their own option', () => {
    const facet = locationFacet([
      { value: null, kind: null, count: 2 },
      { value: 'Oldham', kind: 'district', count: 1 },
    ])
    expect(facet.at(-1)).toEqual({
      value: NO_LOCATION,
      label: 'No location recorded',
      count: 2,
      kind: null,
    })
  })

  // The filter matches on the name, so two kinds of the same name are one set of rows.
  it('folds one name under two kinds into one option wearing the commoner kind', () => {
    expect(
      locationFacet([
        { value: 'Norwich', kind: 'district', count: 3 },
        { value: 'Norwich', kind: 'unmatched', count: 1 },
      ]),
    ).toEqual([{ value: 'Norwich', label: 'Norwich', count: 4, kind: 'district' }])
  })
})
