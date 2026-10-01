import { describe, expect, it } from 'vitest'
import { mailtoHref } from './mailto'

describe('mailtoHref', () => {
  it('keeps the @ in the address, which some mail clients will not decode', () => {
    expect(mailtoHref('fundraising@positivefutures.org.uk')).toBe(
      'mailto:fundraising@positivefutures.org.uk',
    )
  })

  it('trims the address and still encodes what could break out of it', () => {
    expect(mailtoHref('  a+b@example.org ')).toBe('mailto:a%2Bb@example.org')
    expect(mailtoHref('a@example.org?bcc=x@evil.test')).toBe(
      'mailto:a@example.org%3Fbcc%3Dx@evil.test',
    )
  })

  it('writes spaces in the subject and body as %20, never +', () => {
    expect(
      mailtoHref('a@example.org', { subject: 'Your application (REF 1)', body: 'Hello there' }),
    ).toBe('mailto:a@example.org?subject=Your%20application%20(REF%201)&body=Hello%20there')
  })

  it('leaves out a field that is empty', () => {
    expect(mailtoHref('a@example.org', { subject: '', body: 'Hi' })).toBe(
      'mailto:a@example.org?body=Hi',
    )
  })
})
