import { describe, it, expect } from 'vitest'
import { matchCommonKey, normaliseKey, COMMON_MAPPINGS } from './common'

describe('normaliseKey', () => {
  it('lowercases, strips apostrophes, currency and punctuation, collapses whitespace', () => {
    expect(normaliseKey("Your bank's name")).toBe('your banks name')
    expect(normaliseKey('  Bank   Account  Number ')).toBe('bank account number')
    expect(normaliseKey('Organisation/charity name')).toBe('organisation charity name')
    expect(normaliseKey('Amount requested (£)')).toBe('amount requested')
    expect(normaliseKey('How much funding\nare you requesting?')).toBe(
      'how much funding are you requesting',
    )
  })
})

describe('matchCommonKey — real form variants', () => {
  const cases: Array<[string, string]> = [
    // Montirex
    ['Organisation name', 'organisationName'],
    ['Bank name', 'bankName'],
    ['Bank account name', 'bankAccountName'],
    ['Bank account number', 'bankAccountNumber'],
    ['Bank sort code', 'bankSortCode'],
    ['Funding requested', 'amountRequested'],
    ['Project delivery postcode', 'deliveryArea'],
    // the7stars (Gravity Forms wording)
    ["Your bank's name", 'bankName'],
    ['Your bank account number', 'bankAccountNumber'],
    ['Entry ID', 'externalApplicationId'],
    ['Organisation/charity name', 'organisationName'],
    ['Charity registration number', 'charityNumber'],
    // Arete (possessive variants, different word order)
    ['Charity/Organisation Name', 'organisationName'],
    ["Your bank account's name.", 'bankAccountName'],
    ["Your bank account's number.", 'bankAccountNumber'],
    ["Your bank account's sort code.", 'bankSortCode'],
    ['Charity Number', 'charityNumber'],
  ]
  it.each(cases)('%s → %s', (input, expected) => {
    expect(matchCommonKey(input)).toBe(expected)
  })

  it('does NOT map ambiguous "Organisation registration number"', () => {
    expect(matchCommonKey('Organisation registration number')).toBeNull()
  })

  it('does NOT map an ambiguous bare "Token" (too generic to auto-apply)', () => {
    expect(matchCommonKey('Token')).toBeNull()
  })

  it('does NOT map an org-location field to deliveryArea', () => {
    expect(matchCommonKey('In what region is your organisation based?')).toBeNull()
  })

  it('returns null for an unknown field', () => {
    expect(matchCommonKey('Favourite colour')).toBeNull()
  })
})

describe('COMMON_MAPPINGS integrity', () => {
  it('has no alias claimed by two canonical fields (load-time guard already enforces this)', () => {
    const seen = new Map<string, string>()
    for (const [canonical, aliases] of Object.entries(COMMON_MAPPINGS)) {
      for (const alias of aliases ?? []) {
        const norm = normaliseKey(alias)
        const prev = seen.get(norm)
        expect(prev === undefined || prev === canonical).toBe(true)
        seen.set(norm, canonical)
      }
    }
  })
})
