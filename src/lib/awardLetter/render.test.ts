import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRANT_CONDITIONS,
  MISSING_TOKEN_PLACEHOLDER,
  renderAwardLetterBody,
  renderTemplate,
} from './template'
import { awardLetterHtml, paymentSummary, renderAwardLetter, type AwardLetterInput } from './render'

const input: AwardLetterInput = {
  organisationName: 'Pennine Youth Alliance',
  foundationName: 'Rothbury Family Foundation',
  amountAwarded: 38000,
  purpose: 'early intervention youth work in Calderdale',
  startDate: '2026-08-01',
  programmeName: 'Young People & Education',
  roundName: 'Spring 2026',
  reference: 'APP-003',
  instalments: [
    { amount: 19000, dueDate: '2026-08-01' },
    { amount: 19000, dueDate: '2027-02-01' },
  ],
  reporting: [{ label: 'Interim report', dueDate: '2027-02-01' }],
  signatory: 'Jane Fairfax, Chair of Trustees',
  issuedAt: new Date('2026-07-31T12:00:00Z'),
}

describe('renderTemplate', () => {
  it('substitutes known tokens', () => {
    expect(renderTemplate('Dear {{name}},', { name: 'Alice' })).toBe('Dear Alice,')
  })

  it('leaves unknown tokens visible so a typo is caught in preview', () => {
    expect(renderTemplate('Dear {{nmae}},', { name: 'Alice' })).toBe('Dear {{nmae}},')
  })

  it('marks a known-but-empty token rather than silently blanking it', () => {
    expect(renderTemplate('towards {{purpose}}.', { purpose: '' })).toBe(
      `towards ${MISSING_TOKEN_PLACEHOLDER}.`,
    )
  })

  it('treats empty conditions as a real choice, not an omission', () => {
    expect(renderTemplate('a{{conditions}}b', { conditions: '' })).toBe('ab')
  })

  it('collapses the blank-line run an empty block token leaves behind', () => {
    expect(renderTemplate('one\n\n{{conditions}}\n\ntwo', { conditions: '' })).toBe('one\n\ntwo')
  })
})

describe('renderAwardLetterBody', () => {
  const vars = { organisationName: 'Acme' }

  it('places the conditions where the token sits', () => {
    const body = renderAwardLetterBody({
      template: 'Hello {{organisationName}}.\n\n{{conditions}}\n\nYours,',
      conditions: ['Only for the agreed purpose.'],
      vars,
    })
    expect(body).toContain('1. Only for the agreed purpose.')
    expect(body.indexOf('1. Only')).toBeLessThan(body.indexOf('Yours,'))
  })

  // A foundation rewriting the letter should not be able to accidentally drop the
  // contractual terms; the letter is the record of what was agreed.
  it('appends the conditions when a custom template omits the token', () => {
    const body = renderAwardLetterBody({
      template: 'Hello {{organisationName}}.',
      conditions: ['Only for the agreed purpose.'],
      vars,
    })
    expect(body).toContain('Conditions of grant')
    expect(body).toContain('1. Only for the agreed purpose.')
  })

  it('adds nothing when there are no conditions at all', () => {
    const body = renderAwardLetterBody({
      template: 'Hello {{organisationName}}.',
      conditions: [],
      vars,
    })
    expect(body).toBe('Hello Acme.')
  })
})

describe('paymentSummary', () => {
  it('reads as prose', () => {
    expect(paymentSummary(1)).toBe('a single payment')
    expect(paymentSummary(2)).toBe('two instalments')
    expect(paymentSummary(12)).toBe('12 instalments')
  })
})

describe('renderAwardLetter', () => {
  it('renders the default letter with the grant facts filled in', () => {
    const letter = renderAwardLetter({ input, settings: null })
    expect(letter.subject).toBe('Your grant from Rothbury Family Foundation')
    expect(letter.bodyText).toContain('Dear Pennine Youth Alliance,')
    expect(letter.bodyText).toContain('a grant of £38,000')
    expect(letter.bodyText).toContain('towards early intervention youth work in Calderdale')
    expect(letter.bodyText).toContain('two instalments')
    expect(letter.bodyText).toContain('1. £19,000 — 1 Aug 2026')
    expect(letter.bodyText).toContain('Interim report — 1 Feb 2027')
    expect(letter.bodyText).toContain('Jane Fairfax, Chair of Trustees')
    expect(letter.conditions).toEqual(DEFAULT_GRANT_CONDITIONS)
  })

  it('numbers a grant-specific condition continuously with the standard ones', () => {
    const letter = renderAwardLetter({
      input,
      settings: null,
      specialCondition: 'Restricted to capital works.',
    })
    expect(letter.conditions).toHaveLength(DEFAULT_GRANT_CONDITIONS.length + 1)
    expect(letter.conditions.at(-1)).toBe('Restricted to capital works.')
    expect(letter.bodyText).toContain(
      `${DEFAULT_GRANT_CONDITIONS.length + 1}. Restricted to capital works.`,
    )
  })

  it("uses the foundation's overrides when set", () => {
    const letter = renderAwardLetter({
      input,
      settings: {
        template: 'Dear {{organisationName}} — {{amount}} for {{purpose}}.\n\n{{conditions}}',
        conditions: ['Our one condition.'],
        signatory: null,
      },
    })
    expect(letter.bodyText).toBe(
      'Dear Pennine Youth Alliance — £38,000 for early intervention youth work in Calderdale.\n\nConditions of grant\n\n1. Our one condition.',
    )
  })

  it('falls back to the settings signatory when the award has none', () => {
    const letter = renderAwardLetter({
      input: { ...input, signatory: null },
      settings: { signatory: 'The Trustees' },
    })
    expect(letter.bodyText).toContain('The Trustees')
  })

  it('says so plainly when no reporting milestones were set', () => {
    const letter = renderAwardLetter({ input: { ...input, reporting: [] }, settings: null })
    expect(letter.bodyText).toContain('No formal reporting milestones have been set')
  })

  it('flags a missing purpose instead of leaving a hole', () => {
    const letter = renderAwardLetter({ input: { ...input, purpose: null }, settings: null })
    expect(letter.bodyText).toContain(`towards ${MISSING_TOKEN_PLACEHOLDER}`)
  })
})

describe('awardLetterHtml', () => {
  // The template is authored by a foundation admin but the letter is emailed to a
  // third-party charity — it must never carry markup through.
  it('escapes the template text rather than trusting it as HTML', () => {
    const html = awardLetterHtml('Dear <script>alert(1)</script>,')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders a numbered block as an ordered list', () => {
    const html = awardLetterHtml('1. First thing\n2. Second thing')
    expect(html).toContain('<ol')
    expect(html).toContain('<li style="margin:0 0 8px;line-height:1.55;">First thing</li>')
  })

  it('keeps single newlines inside a paragraph as line breaks', () => {
    expect(awardLetterHtml('Yours sincerely,\nJane')).toContain('Yours sincerely,<br />Jane')
  })
})
