import { describe, expect, it } from 'vitest'
import { renderDeclineLetter, type DeclineLetterInput } from './render'
import { DEFAULT_DECLINE_LETTER_TEMPLATE } from './template'

const INPUT: DeclineLetterInput = {
  organisationName: 'Pennine Youth Alliance',
  foundationName: 'The Fairfax Foundation',
  programmeName: 'Young People & Education',
  roundName: 'Spring 2026',
  reference: 'APP-003',
  amountRequested: 38000,
  signatory: null,
  issuedAt: new Date('2026-09-06T09:00:00Z'),
}

describe('renderDeclineLetter', () => {
  it('renders the built-in letter when the foundation has no template', () => {
    const letter = renderDeclineLetter({ input: INPUT, settings: null })
    expect(letter.subject).toBe('Your application to The Fairfax Foundation')
    expect(letter.bodyText).toContain('Dear Pennine Youth Alliance,')
    expect(letter.bodyText).toContain('not able to fund your application')
    expect(letter.bodyText.endsWith('The Fairfax Foundation')).toBe(true)
  })

  it('never quotes the amount asked for in the built-in letter', () => {
    // The sum an applicant asked for and did not get reads as a rebuke. It is available
    // as a token for a foundation that wants it; it is not in the default.
    expect(DEFAULT_DECLINE_LETTER_TEMPLATE).not.toContain('amountRequested')
  })

  it('signs with the award letter’s signatory when the decline letter has none', () => {
    const letter = renderDeclineLetter({
      input: INPUT,
      settings: { template: null, signatory: null },
      awardSignatory: 'Jane Fairfax, Chair of Trustees',
    })
    expect(letter.bodyText).toContain('Jane Fairfax, Chair of Trustees')
  })

  it('prefers its own signatory over the award letter’s', () => {
    const letter = renderDeclineLetter({
      input: INPUT,
      settings: { template: null, signatory: 'Ravi Patel, Grants Manager' },
      awardSignatory: 'Jane Fairfax, Chair of Trustees',
    })
    expect(letter.bodyText).toContain('Ravi Patel, Grants Manager')
    expect(letter.bodyText).not.toContain('Jane Fairfax')
  })

  it('collapses the sign-off rather than printing a placeholder when nobody signs', () => {
    // `signatory` is legitimately empty — plenty of foundations sign in the
    // foundation's name alone — so the line goes rather than reading "[not set]".
    const letter = renderDeclineLetter({ input: INPUT, settings: null })
    expect(letter.bodyText).not.toContain('[not set]')
    expect(letter.bodyText).toContain('Yours sincerely,\n\nThe Fairfax Foundation')
  })

  it('fills a foundation’s own tokens', () => {
    const letter = renderDeclineLetter({
      input: INPUT,
      settings: {
        template:
          '{{organisationName}} applied to {{programmeName}} in {{roundName}} ({{reference}}) for {{amountRequested}} on {{today}}.',
        signatory: null,
      },
    })
    expect(letter.bodyText).toBe(
      'Pennine Youth Alliance applied to Young People & Education in Spring 2026 (APP-003) for £38,000 on 6 Sept 2026.',
    )
  })

  it('treats a foundation’s template as text, never as markup', () => {
    const letter = renderDeclineLetter({
      input: { ...INPUT, organisationName: '<script>alert(1)</script>' },
      settings: null,
    })
    expect(letter.bodyHtml).not.toContain('<script>')
    expect(letter.bodyHtml).toContain('&lt;script&gt;')
  })
})
