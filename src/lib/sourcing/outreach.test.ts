import { describe, expect, it } from 'vitest'
import { defaultOutreach, renderOutreach } from './outreach'

const CTX = {
  foundationName: 'Wrenfield Foundation',
  programmeName: 'Youth Fund',
  contactName: 'Amina',
  senderName: null,
}

describe('emails to an organisation that has not applied yet', () => {
  it('puts the link under an invitation, in both parts', () => {
    const link = 'https://wrenfield.org.uk/apply?custodian_ref=p_1'
    const { text, html } = renderOutreach('apply_invite', 'Dear Amina,\n\nPlease apply.', link)
    expect(text).toContain(`Start your application:\n${link}`)
    expect(html).toContain(`href="${link}"`)
    expect(html).toContain('target="_blank"')
  })

  it('adds no link to a plain message', () => {
    const { text, html } = renderOutreach('message', 'Good to meet you.', null)
    expect(text).toBe('Good to meet you.')
    expect(html).not.toContain('<a ')
  })

  // An admin's words go to a third party under the foundation's name. Text, never markup.
  it('escapes what the admin typed and the link it is given', () => {
    const { html } = renderOutreach(
      'eoi_invite',
      '<script>alert(1)</script>',
      'https://example.org/?a=1&b="2"',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a=1&amp;b=&quot;2&quot;')
  })

  it('starts from text a person would send, with no em dashes', () => {
    for (const kind of ['message', 'eoi_invite', 'apply_invite'] as const) {
      const { subject, body } = defaultOutreach(kind, CTX)
      expect(`${subject}${body}`).not.toContain('—')
      expect(body).toContain('Dear Amina,')
      expect(body).toContain('Wrenfield Foundation')
    }
    expect(defaultOutreach('apply_invite', CTX).body).toContain('Youth Fund')
  })
})
