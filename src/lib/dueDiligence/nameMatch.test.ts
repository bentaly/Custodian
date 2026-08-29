import { describe, expect, it } from 'vitest'
import { bestNameMatch, compareOrgNames, normaliseOrgName } from './nameMatch'

describe('normaliseOrgName', () => {
  it('folds case, punctuation, accents and the ampersand', () => {
    expect(normaliseOrgName('Barnardo’s')).toBe(normaliseOrgName('BARNARDOS'))
    expect(normaliseOrgName('Age UK & Co')).toBe(normaliseOrgName('Age UK and Co'))
    expect(normaliseOrgName('Café Trust')).toBe(normaliseOrgName('Cafe Trust'))
  })

  it('drops legal forms but keeps identity words', () => {
    expect(normaliseOrgName('The Arete Foundation Limited')).toBe('arete foundation')
    expect(normaliseOrgName('Rivertown CIC')).toBe('rivertown')
    // "trust" and "foundation" are part of the name, not noise.
    expect(normaliseOrgName('Smith Trust')).not.toBe(normaliseOrgName('Smith Foundation'))
  })
})

describe('compareOrgNames', () => {
  it('matches across legal form and article differences', () => {
    expect(compareOrgNames('Arete Foundation', 'The Arete Foundation Limited').match).toBe(true)
    expect(compareOrgNames('Rivertown Community Interest Company', 'Rivertown CIC').match).toBe(
      true,
    )
  })

  it('matches a different word order and a working name', () => {
    expect(compareOrgNames('Foundation Arete', 'Arete Foundation').match).toBe(true)
    const contained = compareOrgNames('Arete Foundation', 'Arete Foundation for Community Action')
    expect(contained.match).toBe(true)
    expect(contained.reason).toBe('one name contains the other in full')
  })

  it('matches an acronym against the spelled-out name', () => {
    expect(compareOrgNames('NSPCC', 'National Society Prevention Cruelty Children').match).toBe(
      true,
    )
  })

  it('forgives a typo', () => {
    const result = compareOrgNames('Arete Foundaton', 'Arete Foundation')
    expect(result.match).toBe(true)
    expect(result.reason).toBe('differs by one character')
  })

  it('does NOT match two different organisations', () => {
    expect(compareOrgNames('Arete Foundation', 'Riverside Housing Trust').match).toBe(false)
    // The case this check exists for: a mistyped number landing on a real charity.
    expect(compareOrgNames('Northbank Youth Project', 'Dogs Trust').match).toBe(false)
  })

  it('does not fold two similarly-shaped but distinct names together', () => {
    expect(compareOrgNames('Smith Trust', 'Smith Foundation').match).toBe(false)
  })

  it('reports when nothing identity-carrying is left to compare', () => {
    expect(compareOrgNames('The Limited', 'Arete Foundation')).toMatchObject({
      match: false,
      reason: 'no comparable name',
    })
  })
})

describe('bestNameMatch', () => {
  it('falls back to a former name and says so', () => {
    const result = bestNameMatch('Northbank Youth Project', [
      'Riverside Community Ventures',
      'Northbank Youth Project',
    ])
    expect(result?.match).toBe(true)
    expect(result?.viaPreviousName).toBe(true)
  })

  it('prefers the current name when both match', () => {
    const result = bestNameMatch('Arete Foundation', ['Arete Foundation', 'Arete Fund'])
    expect(result?.viaPreviousName).toBe(false)
  })

  it('returns null when there is nothing to compare against', () => {
    expect(bestNameMatch('Arete Foundation', [])).toBeNull()
    expect(bestNameMatch('   ', ['Arete Foundation'])).toBeNull()
  })
})
