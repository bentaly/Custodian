import { describe, expect, it } from 'vitest'
import { IMPACT_UNITS, impactUnitLabel, impactUnitSingular } from './impactUnits'

describe('impactUnitSingular', () => {
  it('gives "person" for the default unit', () => {
    // The bug this exists for: the cost-per-beneficiary card read "£175 per people",
    // because the singular was derived by stripping a trailing "s" from "People".
    expect(impactUnitSingular('people')).toBe('Person')
  })

  it('answers from the curated list for every known unit', () => {
    for (const unit of IMPACT_UNITS) {
      if (unit.key === 'other') continue
      expect(impactUnitSingular(unit.key)).toBe(unit.singular)
    }
  })

  it('falls back to the default unit for an unknown or missing key', () => {
    expect(impactUnitSingular(null)).toBe('Person')
    expect(impactUnitSingular('nonsense')).toBe('Person')
    // 'other' with nothing typed in is not a unit — same fallback as the plural.
    expect(impactUnitSingular('other', '  ')).toBe('Person')
    expect(impactUnitLabel('other', '  ')).toBe('People')
  })

  it('inflects the head noun of a custom phrase, wherever it sits', () => {
    // A tail after the noun ...
    expect(impactUnitSingular('other', 'hectares of peatland restored')).toBe(
      'hectare of peatland restored',
    )
    expect(impactUnitSingular('other', 'families supported')).toBe('family supported')
    expect(impactUnitSingular('other', 'boxes delivered')).toBe('box delivered')
    expect(impactUnitSingular('other', 'children reached')).toBe('child reached')
    expect(impactUnitSingular('other', 'young people supported')).toBe('young person supported')
    // ... and a compound, where the last word is the one carrying number.
    expect(impactUnitSingular('other', 'bus routes')).toBe('bus route')
  })

  it('keeps the case the foundation wrote', () => {
    expect(impactUnitSingular('other', 'People trained')).toBe('Person trained')
  })

  it('leaves a phrase it cannot inflect alone', () => {
    // Better an unchanged phrase than a mangled one: "per fish" is right already.
    expect(impactUnitSingular('other', 'fish rescued')).toBe('fish rescued')
  })

  it('does not mistake a singular ending in s for a plural', () => {
    expect(impactUnitSingular('other', 'bus stops')).toBe('bus stop')
    expect(impactUnitSingular('other', 'apparatus')).toBe('apparatus')
    expect(impactUnitSingular('other', 'analysis published')).toBe('analysis published')
  })
})
