import { describe, it, expect } from 'vitest'
import { applyLookup, toStringValue } from './match'
import type { FieldMappingEntry } from './types'

const FULL_MAPPINGS: FieldMappingEntry[] = [
  { sourceKey: 'programme', canonicalField: 'programmeName' },
  { sourceKey: 'app_ref', canonicalField: 'externalApplicationId' },
  { sourceKey: 'org', canonicalField: 'organisationName' },
  { sourceKey: 'amount', canonicalField: 'amountRequested' },
  { sourceKey: 'bank', canonicalField: 'bankName' },
  { sourceKey: 'acc_name', canonicalField: 'bankAccountName' },
  { sourceKey: 'acc_no', canonicalField: 'bankAccountNumber' },
  { sourceKey: 'sort', canonicalField: 'bankSortCode' },
]

const FULL_PAYLOAD = {
  programme: 'Youth Employment Fund',
  app_ref: 'EXT-123',
  org: 'Test Charity',
  amount: '£15,000',
  bank: 'Barclays',
  acc_name: 'Test Charity',
  acc_no: '12345678',
  sort: '20-00-00',
  motivation: 'Because we help people', // leftover → responses
}

describe('toStringValue', () => {
  it('trims strings and stringifies primitives', () => {
    expect(toStringValue('  hi ')).toBe('hi')
    expect(toStringValue(42)).toBe('42')
    expect(toStringValue(true)).toBe('true')
    expect(toStringValue(null)).toBe('')
    expect(toStringValue(undefined)).toBe('')
  })
})

describe('applyLookup', () => {
  it('resolves all required fields via the lookup table', () => {
    const r = applyLookup(FULL_PAYLOAD, FULL_MAPPINGS)
    expect(r.unresolvedRequired).toEqual([])
    expect(r.resolved.organisationName).toEqual({ sourceKey: 'org', value: 'Test Charity' })
    expect(r.resolved.amountRequested).toEqual({ sourceKey: 'amount', value: '£15,000' })
    // unmapped key flows to responses, not a canonical field
    expect(r.leftoverKeys).toEqual(['motivation'])
  })

  it('reports unresolved required fields when a mapping is missing', () => {
    const mappings = FULL_MAPPINGS.filter((m) => m.canonicalField !== 'bankSortCode')
    const r = applyLookup(FULL_PAYLOAD, mappings)
    expect(r.unresolvedRequired).toEqual(['bankSortCode'])
    // the still-present payload key with no mapping becomes a leftover
    expect(r.leftoverKeys).toContain('sort')
  })

  it('treats an exact canonical key as an identity match (no lookup row needed)', () => {
    const r = applyLookup({ organisationName: 'Direct Co' }, [])
    expect(r.resolved.organisationName).toEqual({
      sourceKey: 'organisationName',
      value: 'Direct Co',
    })
    expect(r.leftoverKeys).toEqual([])
  })

  it('does not resolve a mapped field whose value is empty, and does not leak it to responses', () => {
    const r = applyLookup({ ...FULL_PAYLOAD, org: '' }, FULL_MAPPINGS)
    expect(r.resolved.organisationName).toBeUndefined()
    expect(r.unresolvedRequired).toContain('organisationName')
    expect(r.leftoverKeys).not.toContain('org')
  })

  it('does not list optional fields as unresolved when absent', () => {
    const r = applyLookup(FULL_PAYLOAD, FULL_MAPPINGS)
    expect(r.unresolvedRequired).not.toContain('charityNumber')
    expect(r.unresolvedRequired).not.toContain('companyNumber')
  })
})
