import { describe, expect, it } from 'vitest'
import { decodeEoi, pickEoiProgramme, purposeAnswer, type EoiProgramme } from './decode'

const PROGRAMMES: EoiProgramme[] = [
  { id: 'youth', name: 'Youth Fund' },
  { id: 'place', name: 'Community & Place' },
]
const PARTNERSHIP = '3e44a215-e481-811e-aa8f-c92fffb321c2'

function decode(payload: Record<string, unknown>, programmes = PROGRAMMES) {
  return decodeEoi(payload, Object.keys(payload), [], programmes)
}

describe('reading an expression of interest', () => {
  it('puts what it recognises on columns and keeps every answer', () => {
    const eoi = decode({
      'Organisation name': 'Settlefield Trust',
      'Charity number': '1180432',
      Email: 'hello@settlefield.org.uk',
      Programme: 'youth fund',
      'What would you like to do?': 'Run a Saturday club.',
    })
    expect(eoi.organisationName).toBe('Settlefield Trust')
    expect(eoi.charityNumber).toBe('1180432')
    expect(eoi.programmeId).toBe('youth')
    // Recognised fields stay among the answers: the screen shows the EOI as it was sent.
    expect(eoi.responses.map((r) => r.label)).toEqual([
      'Organisation name',
      'Charity number',
      'Email',
      'Programme',
      'What would you like to do?',
    ])
  })

  // The whole point of the lighter stage: nothing holds it.
  it('still lands when nothing at all is recognised', () => {
    const eoi = decode({ 'Tell us about you': 'We are a youth club in Leeds.' })
    expect(eoi.organisationName).toBeNull()
    expect(eoi.programmeId).toBeNull()
    expect(eoi.responses).toEqual([
      { label: 'Tell us about you', value: 'We are a youth club in Leeds.' },
    ])
  })

  // No AI mapper here, so the two things an EOI form words most loosely are read by
  // shape: the one answer that is an email address, and a question about money.
  it('finds the email and the amount however the form words them', () => {
    const eoi = decode({
      'Your name': 'Priya Mistry',
      'Best way to reach you': 'priya@ladderlane.org.uk',
      'Roughly how much would you ask for?': '£35,000',
      'How many people would it reach?': 'About 60',
    })
    expect(eoi.contactEmail).toBe('priya@ladderlane.org.uk')
    expect(eoi.amountIndicative).toBe(35000)
  })

  // Two addresses could be the organisation's and a referee's: not ours to pick.
  it('takes no email when there are two', () => {
    const eoi = decode({ 'Your email': 'a@one.org', 'Referee email': 'b@two.org' })
    expect(eoi.contactEmail).toBeNull()
  })

  it('reads one figure as the amount and leaves a range as an answer', () => {
    expect(decode({ 'Amount requested': '£15k' }).amountIndicative).toBe(15000)
    const range = decode({ 'Amount requested': 'Between £5,000 and £10,000' })
    expect(range.amountIndicative).toBeNull()
    expect(range.responses[0]!.value).toBe('Between £5,000 and £10,000')
  })

  // The reference is plumbing the foundation's form handed back, not something the
  // organisation said, so it is read and then left out of what is shown.
  it('reads the invitation reference and keeps it out of the answers', () => {
    const eoi = decode({ 'Organisation name': 'Settlefield', custodian_ref: `p_${PARTNERSHIP}` })
    expect(eoi.inviteRef).toEqual({ kind: 'partnership', id: PARTNERSHIP })
    expect(eoi.responses.map((r) => r.label)).toEqual(['Organisation name'])
  })

  it('takes a taught mapping over the dictionary', () => {
    const eoi = decodeEoi(
      { 'Who are you?': 'Settlefield Trust' },
      ['Who are you?'],
      [{ sourceKey: 'Who are you?', canonicalField: 'organisationName' }],
      PROGRAMMES,
    )
    expect(eoi.organisationName).toBe('Settlefield Trust')
  })
})

describe('placing an EOI in a programme', () => {
  it('uses a form title that names exactly one programme', () => {
    expect(pickEoiProgramme([], 'Community & Place: expression of interest', PROGRAMMES)).toBe(
      'place',
    )
  })

  it('falls back to the one programme that takes EOIs', () => {
    const one = [PROGRAMMES[0]!, { ...PROGRAMMES[1]!, acceptsEois: true }]
    expect(pickEoiProgramme([], 'Tell us about your idea', one)).toBe('place')
  })

  it('falls back to the only programme the foundation runs', () => {
    expect(pickEoiProgramme([], 'Tell us about your idea', [PROGRAMMES[0]!])).toBe('youth')
  })

  // Filed under the wrong programme, an EOI is somewhere nobody will look for it.
  it('says nothing rather than choose between two', () => {
    expect(pickEoiProgramme([], 'Tell us about your idea', PROGRAMMES)).toBeNull()
    expect(pickEoiProgramme([], 'Youth Fund or Community & Place', PROGRAMMES)).toBeNull()
  })
})

describe('suggesting a grant purpose', () => {
  // Some EOI forms ask what the money is for and some do not; when one does, the
  // shortlist dialog starts from their words rather than a blank box.
  it('finds the answer to a question about what the funding is for', () => {
    expect(
      purposeAnswer([
        { label: 'Organisation name', value: 'Ladder Lane' },
        { label: 'What would you like funding for?', value: 'A youth employability course.' },
      ]),
    ).toBe('A youth employability course.')
    expect(purposeAnswer([{ label: 'Purpose of the grant', value: 'Core costs' }])).toBe(
      'Core costs',
    )
  })

  it('suggests nothing when the form did not ask', () => {
    expect(purposeAnswer([{ label: 'Tell us about you', value: 'We run a youth club.' }])).toBe(
      null,
    )
  })
})
