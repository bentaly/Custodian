import { describe, expect, it } from 'vitest'
import { initials } from './Avatar'

describe('initials', () => {
  it('skips a leading "The"', () => {
    expect(initials('The Montirex Foundation')).toBe('MF')
    expect(initials('the ropewalk youth centre')).toBe('RY')
  })

  it('keeps "The" when it is the whole name, and anywhere but the start', () => {
    expect(initials('The')).toBe('T')
    expect(initials('Arete The Foundation')).toBe('AT')
  })

  it('takes the first two words otherwise', () => {
    expect(initials('Sean’s Place')).toBe('SP')
    expect(initials('Theatre Royal')).toBe('TR')
  })
})
