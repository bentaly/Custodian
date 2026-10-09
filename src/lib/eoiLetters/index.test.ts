import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EOI_DECLINE_TEMPLATE,
  DEFAULT_EOI_INVITE_TEMPLATE,
  renderEoiDecline,
  renderEoiInvite,
  storedTemplate,
} from '.'

const input = {
  organisationName: 'Pennine Youth Alliance',
  foundationName: 'The Wrenfield Foundation',
  programmeName: 'Warm Homes',
  signatory: 'Jane Fairfax, Chair of Trustees',
  issuedAt: new Date('2026-10-08T00:00:00Z'),
}

describe('EOI letters', () => {
  it('renders the standard decline with every token filled', () => {
    const letter = renderEoiDecline(input, null)
    expect(letter.subject).toBe('Your expression of interest to The Wrenfield Foundation')
    expect(letter.bodyText).toContain('Dear Pennine Youth Alliance,')
    expect(letter.bodyText).toContain('cannot progress you to our application stage')
    expect(letter.bodyText).toContain('Jane Fairfax, Chair of Trustees\nThe Wrenfield Foundation')
    expect(letter.bodyText).not.toContain('{{')
    expect(letter.bodyHtml).toContain('Pennine Youth Alliance')
  })

  it('signs off as the foundation alone when nobody is set to sign', () => {
    const letter = renderEoiDecline({ ...input, signatory: null }, null)
    expect(letter.bodyText).toMatch(/Yours sincerely,\n\nThe Wrenfield Foundation$/)
  })

  it('names the programme in the invitation', () => {
    const invite = renderEoiInvite(input, null)
    expect(invite.subject).toBe('An invitation to apply to The Wrenfield Foundation')
    expect(invite.body).toContain('submit a full application for Warm Homes.')
    expect(invite.body).toContain('The link below takes you to the application form.')
  })

  it('uses the foundation’s own template where there is one', () => {
    expect(renderEoiDecline(input, 'Hello {{organisationName}}').bodyText).toBe(
      'Hello Pennine Youth Alliance',
    )
  })

  it('stores the standard wording as NULL', () => {
    expect(storedTemplate(DEFAULT_EOI_DECLINE_TEMPLATE, DEFAULT_EOI_DECLINE_TEMPLATE)).toBeNull()
    expect(
      storedTemplate(`  ${DEFAULT_EOI_INVITE_TEMPLATE}\n`, DEFAULT_EOI_INVITE_TEMPLATE),
    ).toBeNull()
    expect(storedTemplate('Mine', DEFAULT_EOI_INVITE_TEMPLATE)).toBe('Mine')
  })
})
