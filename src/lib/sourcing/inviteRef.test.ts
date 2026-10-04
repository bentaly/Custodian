import { describe, expect, it } from 'vitest'
import { findInviteRef, inviteRef, parseInviteRef, withInviteRef } from './inviteRef'

const ID = '3e44a215-e481-811e-aa8f-c92fffb321c2'

describe('the reference an invitation carries', () => {
  it('reads back what it wrote, for both kinds', () => {
    expect(parseInviteRef(inviteRef({ kind: 'partnership', id: ID }))).toEqual({
      kind: 'partnership',
      id: ID,
    })
    expect(parseInviteRef(inviteRef({ kind: 'eoi', id: ID }))).toEqual({ kind: 'eoi', id: ID })
  })

  // A form field is free text. Anything that is not exactly a reference is no reference,
  // rather than a lookup on whatever was typed.
  it('reads nothing from anything else', () => {
    for (const value of ['', 'p_', 'p_not-a-uuid', `x_${ID}`, ID, 42, null, undefined]) {
      expect(parseInviteRef(value)).toBeNull()
    }
  })

  // The foundation names the field on their own form, and Typeform lower-cases hidden
  // field names. One field, however it is spelled.
  it('finds the field under any spelling of its name', () => {
    const value = `p_${ID}`
    for (const key of ['custodian_ref', 'Custodian ref', 'custodianRef', 'CUSTODIAN-REF']) {
      expect(findInviteRef({ Organisation: 'Settlefield', [key]: value })?.id).toBe(ID)
    }
    expect(findInviteRef({ Organisation: 'Settlefield', reference: value })).toBeNull()
  })

  it('puts the reference in the fragment for Typeform and the query elsewhere', () => {
    const ref = { kind: 'partnership', id: ID } as const
    expect(withInviteRef('https://wrenfield.typeform.com/to/abc123', ref)).toBe(
      `https://wrenfield.typeform.com/to/abc123#custodian_ref=p_${ID}`,
    )
    expect(withInviteRef('https://wrenfield.org.uk/apply?fund=youth', ref)).toBe(
      `https://wrenfield.org.uk/apply?fund=youth&custodian_ref=p_${ID}`,
    )
  })

  it('replaces a reference already on the address rather than doubling it', () => {
    const once = withInviteRef('https://wrenfield.org.uk/apply', { kind: 'eoi', id: ID })!
    const twice = withInviteRef(once, { kind: 'partnership', id: ID })!
    expect(twice).toBe(`https://wrenfield.org.uk/apply?custodian_ref=p_${ID}`)
  })

  // The link goes into an email to a third party. Only a web address is one.
  it('refuses an address that is not a web address', () => {
    const ref = { kind: 'eoi', id: ID } as const
    expect(withInviteRef('not a url', ref)).toBeNull()
    expect(withInviteRef('javascript:alert(1)', ref)).toBeNull()
    expect(withInviteRef('mailto:grants@wrenfield.org.uk', ref)).toBeNull()
  })
})
