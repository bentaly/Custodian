import { describe, expect, it } from 'vitest'
import {
  CANONICAL_FIELDS,
  CANONICAL_FIELD_BY_KEY,
  EXPECTED_CANONICAL_KEYS,
  REQUIRED_CANONICAL_KEYS,
  REQUIRED_ONE_OF_GROUPS,
  EXPECTED_ONE_OF_GROUPS,
  describeOneOfGroup,
  unmetOneOfGroups,
} from './canonical'
import { fieldGaps, missingRegistrationNumber } from './gaps'

describe('canonical tiers', () => {
  it('keeps the eight hard-required fields required', () => {
    // Guards the refactor from boolean → tier: these are the fields without which an
    // application cannot exist, and silently demoting one would let a submission
    // through with no payable account or no programme.
    expect(REQUIRED_CANONICAL_KEYS).toEqual([
      'programmeName',
      'externalApplicationId',
      'organisationName',
      'applicantEmail',
      'amountRequested',
      'bankAccountName',
      'bankAccountNumber',
      'bankSortCode',
    ])
  })

  it('does not require the bank name', () => {
    // The three fields above are what a payment needs; the bank's NAME is not one of
    // them (the sort code identifies the bank, and `checkBankAccount` never reads this).
    // Required, it held every submission from a form that doesn't ask for it — which is
    // what real foundation forms look like. See the field's comment in the registry.
    expect(REQUIRED_CANONICAL_KEYS).not.toContain('bankName')
    expect(CANONICAL_FIELD_BY_KEY.bankName.tier).toBe('optional')
  })

  it('gives no `optional` field a `degrades` explanation', () => {
    // The mirror of the `expected` rule below, and the line between the two tiers: an
    // optional field with something to say about its absence was misfiled — it is
    // `expected`, and the sentence belongs on the application.
    for (const field of CANONICAL_FIELDS.filter((f) => f.tier === 'optional')) {
      expect(field.degrades, `${field.key} is optional but claims a degradation`).toBeFalsy()
    }
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
    // Reported through the budget group rather than as a lone field, since a document
    // link would have answered the same question.
    const gaps = fieldGaps({ ...complete, budgetBreakdown: [] })
    expect(gaps.expected).toEqual([])
    expect(gaps.expectedGroups.map((g) => g.keys)).toEqual([
      ['budgetBreakdown', 'budgetBreakdownLink'],
    ])
  })

  it('reports every gap at once', () => {
    const gaps = fieldGaps({})
    expect(gaps.any).toBe(true)
    expect(gaps.oneOf).toHaveLength(1)
    expect(gaps.expectedGroups).toHaveLength(1)
    expect(gaps.expected.map((g) => g.key)).toEqual(['deliveryArea', 'proposedImpactQuantity'])
  })
})

describe('the budget pair', () => {
  // A budget can arrive as line items or as an uploaded document. Either answers the
  // question, so the gap panel must treat them as one thing — reporting them
  // separately would print "no view of what the money would be spent on" beside the
  // budget document itself, and a panel that cries wolf gets skimmed past.
  const base = {
    charityNumber: '1123456',
    deliveryArea: 'Bradford',
    proposedImpactQuantity: 340,
  }
  const LINES = [{ item: 'Staff costs', amount: 12000 }]
  const LINK = 'https://api.typeform.com/responses/files/abc123/Project_Budget.ods'

  it('groups the two budget fields without blocking the submission', () => {
    expect(EXPECTED_ONE_OF_GROUPS.map((g) => g.keys)).toEqual([
      ['budgetBreakdown', 'budgetBreakdownLink'],
    ])
    // The distinction that matters: `one_of` holds an ingest, `expected` never does.
    // If this pair ever reached REQUIRED_ONE_OF_GROUPS, every foundation that doesn't
    // ask for a budget would have every submission stuck in the review queue.
    expect(REQUIRED_ONE_OF_GROUPS.flat()).not.toContain('budgetBreakdown')
    expect(REQUIRED_ONE_OF_GROUPS.flat()).not.toContain('budgetBreakdownLink')
    expect(unmetOneOfGroups(['charityNumber'])).toEqual([])
  })

  it('reports nothing when the breakdown is present', () => {
    const gaps = fieldGaps({ ...base, budgetBreakdown: LINES })
    expect(gaps.expectedGroups).toEqual([])
  })

  it('reports nothing when only the document link is present', () => {
    const gaps = fieldGaps({ ...base, budgetBreakdownLink: LINK })
    expect(gaps.expectedGroups).toEqual([])
    expect(gaps.any).toBe(false)
  })

  it('reports once — not twice — when neither is present', () => {
    const gaps = fieldGaps(base)
    expect(gaps.expectedGroups).toHaveLength(1)
    expect(gaps.expectedGroups[0]?.label).toBe('budget breakdown or budget document')
    expect(gaps.expectedGroups[0]?.degrades).toMatch(/only the total ask/)
    expect(gaps.any).toBe(true)
  })

  it('never lists a grouped field individually', () => {
    // Both halves absent, and still neither appears in `expected`: the group speaks
    // for them, or the panel would say the same thing twice.
    const keys = fieldGaps(base).expected.map((g) => g.key)
    expect(keys).not.toContain('budgetBreakdown')
    expect(keys).not.toContain('budgetBreakdownLink')
  })

  it('still reports ungrouped expected fields on their own', () => {
    const gaps = fieldGaps({ charityNumber: '1123456', budgetBreakdown: LINES })
    expect(gaps.expected.map((g) => g.key).sort()).toEqual([
      'deliveryArea',
      'proposedImpactQuantity',
    ])
  })
})
