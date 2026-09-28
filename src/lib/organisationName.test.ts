import { describe, expect, it } from 'vitest'
import { isUnnamedOrganisation, tidyRegisteredName, unnamedOrganisation } from './organisationName'

describe('unnamed organisations', () => {
  it('builds the stand-in from the reference and recognises only that shape', () => {
    expect(unnamedOrganisation('WF-123')).toBe('Unnamed (ref WF-123)')
    expect(isUnnamedOrganisation('Unnamed (ref WF-123)')).toBe(true)
    expect(isUnnamedOrganisation('Unnamed Theatre Company')).toBe(false)
  })
})

describe('tidyRegisteredName', () => {
  it('brings a register name out of capitals', () => {
    expect(tidyRegisteredName('THE HARBOUR LIGHTS YOUTH TRUST')).toBe(
      'The Harbour Lights Youth Trust',
    )
  })

  it('keeps initials in capitals and small words in lower case', () => {
    expect(tidyRegisteredName('FRIENDS OF THE WIRRAL FOOD LINK CIC')).toBe(
      'Friends of the Wirral Food Link CIC',
    )
    expect(tidyRegisteredName('YMCA ST HELENS')).toBe('YMCA St Helens')
  })

  it('treats each part of a hyphenated name as a word of its own', () => {
    expect(tidyRegisteredName('STOCKTON-ON-TEES ARTS')).toBe('Stockton-on-Tees Arts')
  })

  it('leaves a name already in mixed case as somebody spelt it', () => {
    expect(tidyRegisteredName('mcCarthy Youth Hub')).toBe('mcCarthy Youth Hub')
  })
})
