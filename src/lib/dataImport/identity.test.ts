import { describe, expect, it } from 'vitest'
import { grantIdentity, matchBlankReferences, type ExistingGrantIdentity } from './identity'

const incoming = (over: Partial<Parameters<typeof matchBlankReferences>[0][number]> = {}) => ({
  rowNumber: 2,
  reference: '',
  organisationName: 'Pennine Youth Alliance',
  awardDate: '2025-06-01',
  amountAwarded: 45000,
  ...over,
})

const held = (over: Partial<ExistingGrantIdentity> = {}): ExistingGrantIdentity => ({
  reference: 'IMP-0001',
  organisationName: 'Pennine Youth Alliance',
  awardDate: '2025-06-01',
  amountAwarded: 45000,
  ...over,
})

describe('grantIdentity', () => {
  it('folds the ways one grantee gets typed', () => {
    expect(grantIdentity(held({ organisationName: 'St. Mary’s Trust' }))).toBe(
      grantIdentity(held({ organisationName: 'St Marys Trust' })),
    )
  })

  it('agrees about an amount however it was written', () => {
    expect(grantIdentity(held({ amountAwarded: 45000 }))).toBe(
      grantIdentity(held({ amountAwarded: 45000.0 })),
    )
  })

  it('separates two grants to the same charity on different days', () => {
    expect(grantIdentity(held())).not.toBe(grantIdentity(held({ awardDate: '2025-07-01' })))
  })
})

describe('matchBlankReferences', () => {
  // The bug this exists for: a foundation told to leave the column blank re-uploads,
  // nothing matches, and their whole portfolio arrives a second time.
  it('recognises a blank row as a grant already imported', () => {
    const result = matchBlankReferences([incoming()], [held()])
    expect(result.byRow.get(2)).toBe('IMP-0001')
    expect(result.unmatchedRows).toEqual([])
  })

  it('leaves a row that states its own reference alone', () => {
    const result = matchBlankReferences([incoming({ reference: 'GR-77' })], [held()])
    expect(result.byRow.size).toBe(0)
    expect(result.unmatchedRows).toEqual([])
  })

  it('reports a genuinely new grant as unmatched', () => {
    const result = matchBlankReferences([incoming({ organisationName: 'Someone Else' })], [held()])
    expect(result.byRow.size).toBe(0)
    expect(result.unmatchedRows).toEqual([2])
  })

  // Overwriting the wrong grant's schedule is worse than a visible duplicate, so an
  // identity that cannot single one out matches nothing on either side.
  it('refuses to guess when two held grants share an identity', () => {
    const result = matchBlankReferences([incoming()], [held(), held({ reference: 'IMP-0002' })])
    expect(result.unmatchedRows).toEqual([2])
  })

  it('refuses to guess when two incoming rows share an identity', () => {
    const result = matchBlankReferences(
      [incoming({ rowNumber: 2 }), incoming({ rowNumber: 3 })],
      [held()],
    )
    expect(result.byRow.size).toBe(0)
    expect(result.unmatchedRows).toEqual([2, 3])
  })

  it('never hands the same reference to two rows', () => {
    const result = matchBlankReferences(
      [incoming({ rowNumber: 2 }), incoming({ rowNumber: 3, amountAwarded: 60000 })],
      [held(), held({ reference: 'IMP-0002', amountAwarded: 60000 })],
    )
    expect([...new Set(result.byRow.values())].length).toBe(result.byRow.size)
  })

  it('does nothing at all on a first import', () => {
    const result = matchBlankReferences([incoming()], [])
    expect(result.byRow.size).toBe(0)
    expect(result.unmatchedRows).toEqual([2])
  })
})
