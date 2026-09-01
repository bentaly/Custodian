// The homonym problem: OS Open Names returns every "Preston" in Great Britain and
// orders them by neither prominence nor size, so taking the first hit scored a
// Lancashire city against a Scottish suburb's deprivation decile. These fixtures
// are the real `/places` payloads (trimmed to the fields the picker reads).
import { describe, expect, it } from 'vitest'
import { pickPlace } from './postcodesIo'

const place = (name_1: string, local_type: string, extentKm: number, region = '') => ({
  name_1,
  local_type,
  region,
  min_eastings: 0,
  max_eastings: extentKm * 1000,
  min_northings: 0,
  max_northings: 0,
})

const pick = (q: string, ps: ReturnType<typeof place>[]) => pickPlace(q, ps, (p) => p)

describe('pickPlace', () => {
  it('prefers the city over the suburb the gazetteer happens to list first', () => {
    // Real ordering from /places?q=Preston: the Lancashire city is SIXTH.
    const chosen = pick('Preston', [
      place('Preston', 'Suburban Area', 1.46, 'Scotland'),
      place('Preston', 'Village', 0.98, 'Scotland'),
      place('Preston', 'Hamlet', 0.58, 'North East'),
      place('Preston', 'Suburban Area', 0.7, 'Scotland'),
      place('Preston', 'Suburban Area', 0.51, 'North East'),
      place('Preston', 'City', 10.15, 'North West'),
    ])
    expect(chosen?.region).toBe('North West')
    expect(chosen?.local_type).toBe('City')
  })

  it('prefers the city over a hamlet of the same name', () => {
    // /places?q=Bradford leads with a South West hamlet. `Bradford` is the
    // example delivery area in the canonical registry, so this one is load-bearing.
    const chosen = pick('Bradford', [
      place('Bradford', 'Hamlet', 0.5, 'South West'),
      place('Bradford', 'Other Settlement', 0.5, 'South West'),
      place('Bradford', 'City', 13.32, 'Yorkshire and the Humber'),
      place('Bradford', 'Suburban Area', 1.87, 'North West'),
    ])
    expect(chosen?.region).toBe('Yorkshire and the Humber')
  })

  it('takes an exact name match over a bigger place that merely starts with it', () => {
    const chosen = pick('Bradford', [
      place('Bradford Moor', 'Town', 20, 'Yorkshire and the Humber'),
      place('Bradford', 'Village', 1.2, 'North West'),
    ])
    expect(chosen?.name_1).toBe('Bradford')
  })

  it('falls back to the full list when nothing matches the name exactly', () => {
    const chosen = pick('Ashton', [place('Ashton-under-Lyne', 'Town', 6, 'North West')])
    expect(chosen?.name_1).toBe('Ashton-under-Lyne')
  })

  it('breaks a tie within a class on size', () => {
    const chosen = pick('Newport', [place('Newport', 'Town', 3), place('Newport', 'Town', 9)])
    expect(extent(chosen)).toBe(9)
  })

  it('ranks an unrecognised class below every named one', () => {
    const chosen = pick('Somewhere', [
      place('Somewhere', 'Something New', 50),
      place('Somewhere', 'Hamlet', 0.4),
    ])
    expect(chosen?.local_type).toBe('Hamlet')
  })

  it('returns null for an empty candidate list', () => {
    expect(pick('Nowhere', [])).toBeNull()
  })
})

function extent(p: ReturnType<typeof place> | null) {
  return p ? (p.max_eastings - p.min_eastings) / 1000 : null
}
