import { describe, expect, it } from 'vitest'
import {
  CANONICAL_FIELDS,
  EXPECTED_CANONICAL_KEYS,
  REQUIRED_CANONICAL_KEYS,
  REQUIRED_ONE_OF_GROUPS,
  describeOneOfGroup,
  unmetOneOfGroups,
} from './canonical'
import { fieldGaps, missingRegistrationNumber } from './gaps'

describe('canonical tiers', () => {
  it('keeps the nine hard-required fields required', () => {
    // Guards the refactor from boolean → tier: these are the fields without which an
    // application cannot exist, and silently demoting one would let a submission
    // through with no bank details or no programme.
    expect(REQUIRED_CANONICAL_KEYS).toEqual([
      'programmeName',
      'externalApplicationId',
      'organisationName',
      'applicantEmail',
      'amountRequested',
      'bankName',
      'bankAccountName',
      'bankAccountNumber',
      'bankSortCode',
    ])
  })

  it('does not mark either registration number as required on its own', () => {
    // An applicant may be a charity, a company, or both — requiring either
    // individually would reject legitimate applicants.
    expect(REQUIRED_CANONICAL_KEYS).not.toContain('charityNumber')
    expect(REQUIRED_CANONICAL_KEYS).not.toContain('companyNumber')
  })

  it('groups the two registration numbers as one-of', () => {
    expect(REQUIRED_ONE_OF_GROUPS).toEqual([['charityNumber', 'companyNumber']])
  })

  it('gives every expected field a `degrades` explanation', () => {
    // The whole point of the tier is that the absence is stated. An expected field
    // with nothing to say would render an empty line on the application.
    for (const key of EXPECTED_CANONICAL_KEYS) {
      const field = CANONICAL_FIELDS.find((f) => f.key === key)!
      expect(field.degrades, `${key} needs a degrades explanation`).toBeTruthy()
    }
  })

  it('describes a group in prose', () => {
    expect(describeOneOfGroup(['charityNumber', 'companyNumber'])).toBe(
      'charity number or company number',
    )
  })
})

describe('unmetOneOfGroups', () => {
  it('reports the group when neither member resolved', () => {
    const unmet = unmetOneOfGroups(['organisationName', 'amountRequested'])
    expect(unmet).toEqual([['charityNumber', 'companyNumber']])
  })

  it('is satisfied by the charity number alone', () => {
    expect(unmetOneOfGroups(['charityNumber'])).toEqual([])
  })

  it('is satisfied by the company number alone', () => {
    expect(unmetOneOfGroups(['companyNumber'])).toEqual([])
  })

  it('is satisfied by both', () => {
    expect(unmetOneOfGroups(['charityNumber', 'companyNumber'])).toEqual([])
  })
})

describe('fieldGaps', () => {
  const complete = {
    charityNumber: '1089464',
    deliveryArea: 'Harpenden',
    budgetBreakdown: [{ item: 'Staff', amount: 1000 }],
    proposedImpactQuantity: '340',
  }

  it('finds nothing wrong with a complete application', () => {
    const gaps = fieldGaps(complete)
    expect(gaps.any).toBe(false)
    expect(gaps.expected).toEqual([])
    expect(gaps.oneOf).toEqual([])
  })

  it('reports the registration pair when neither number is held', () => {
    const gaps = fieldGaps({ ...complete, charityNumber: null })
    expect(gaps.oneOf).toHaveLength(1)
    expect(gaps.oneOf[0]!.label).toBe('charity number or company number')
    expect(missingRegistrationNumber({ ...complete, charityNumber: null })).toBe(true)
  })

  it('accepts a company number in place of a charity number', () => {
    const gaps = fieldGaps({ ...complete, charityNumber: null, companyNumber: '09876543' })
    expect(gaps.oneOf).toEqual([])
  })

  it('reports a missing delivery area with what it costs', () => {
    const gaps = fieldGaps({ ...complete, deliveryArea: null })
    expect(gaps.expected.map((g) => g.key)).toEqual(['deliveryArea'])
    expect(gaps.expected[0]!.degrades).toContain('deprivation')
  })

  // The bug that started this: a value present in the payload but never mapped leaves
  // the column empty, which must read the same as "never sent" — both are a gap.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
  ])('treats %s as not captured', (_label, value) => {
    expect(fieldGaps({ ...complete, charityNumber: value }).oneOf).toHaveLength(1)
  })

  it('treats an empty budget array as not captured', () => {
    const gaps = fieldGaps({ ...complete, budgetBreakdown: [] })
    expect(gaps.expected.map((g) => g.key)).toEqual(['budgetBreakdown'])
  })

  it('reports every gap at once', () => {
    const gaps = fieldGaps({})
    expect(gaps.any).toBe(true)
    expect(gaps.oneOf).toHaveLength(1)
    expect(gaps.expected.map((g) => g.key)).toEqual([
      'deliveryArea',
      'budgetBreakdown',
      'proposedImpactQuantity',
    ])
  })
})
