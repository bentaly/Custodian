import { describe, expect, it } from 'vitest'
import {
  matchesAnyFilter,
  matchesFilter,
  summariseSelection,
  toggleFilterValue,
} from './filterSelection'

const OPTIONS = ['a', 'b', 'c']

describe('toggleFilterValue', () => {
  it('adds a value, in the order it was ticked', () => {
    expect(toggleFilterValue(undefined, 'b', OPTIONS)).toEqual(['b'])
    expect(toggleFilterValue(['b'], 'a', OPTIONS)).toEqual(['b', 'a'])
  })

  it('removes a ticked value, and spells an empty selection as undefined', () => {
    expect(toggleFilterValue(['b', 'a'], 'b', OPTIONS)).toEqual(['a'])
    expect(toggleFilterValue(['a'], 'a', OPTIONS)).toBeUndefined()
  })

  it('stores every option ticked as no filter at all', () => {
    // So a link saved with all three programmes does not quietly hide a fourth added later.
    expect(toggleFilterValue(['a', 'b'], 'c', OPTIONS)).toBeUndefined()
  })

  it('does not collapse a pill with one option, or the tick would never show', () => {
    expect(toggleFilterValue(undefined, 'a', ['a'])).toEqual(['a'])
  })

  it('collapses on every option even with a stale value alongside', () => {
    expect(toggleFilterValue(['gone', 'a', 'b'], 'c', OPTIONS)).toBeUndefined()
  })
})

describe('matching a row', () => {
  it('passes everything when nothing is selected', () => {
    expect(matchesFilter(undefined, null)).toBe(true)
    expect(matchesFilter([], 'x')).toBe(true)
    expect(matchesAnyFilter(undefined, [])).toBe(true)
  })

  it('ORs the values within one filter', () => {
    expect(matchesFilter(['a', 'b'], 'b')).toBe(true)
    expect(matchesFilter(['a', 'b'], 'c')).toBe(false)
    expect(matchesFilter(['a'], null)).toBe(false)
  })

  it('matches a many-valued row on any one of its values', () => {
    expect(matchesAnyFilter(['youth'], ['housing', 'youth'])).toBe(true)
    expect(matchesAnyFilter(['youth', 'arts'], ['housing'])).toBe(false)
  })
})

describe('summariseSelection', () => {
  it('names the whole set when nothing is selected', () => {
    expect(summariseSelection([], 'All themes')).toBe('All themes')
  })

  it('lists up to the limit and counts the rest', () => {
    expect(summariseSelection(['A', 'B'], 'All')).toBe('A, B')
    expect(summariseSelection(['A', 'B', 'C', 'D', 'E'], 'All')).toBe('A, B, C +2 more')
  })
})
