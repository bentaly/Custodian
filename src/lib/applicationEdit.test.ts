import { describe, expect, it } from 'vitest'
import {
  EDITABLE_FIELDS,
  canonicalFromApplication,
  fieldText,
  looksLike,
  moveAnswer,
  rankAnswers,
  setField,
  strictReading,
} from './applicationEdit'
import { CreateApplicationSchema } from './validators/application'

const ROW = {
  roundProgrammeId: '6f1d3c1e-8a51-4c77-9d0b-3f1f4a6c2b10',
  externalApplicationId: 'WF-2026-021',
  organisationName: 'The Lighthouse Youth Foundation',
  organisationSummary: null,
  applicantEmail: 'team@lighthouse.org',
  charityNumber: '1104417',
  companyNumber: null,
  deliveryArea: 'Liverpool City Region',
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankSortCode: null,
  amountRequested: null,
  unrestrictedReserves: '41000.00',
  proposedImpactQuantity: '150',
  budgetBreakdown: null,
  budgetBreakdownLink: null,
  responses: [
    { label: 'Total grant requested', value: '58k across the three years' },
    { label: 'Total project cost', value: '£74,200' },
  ],
  submittedFields: [
    { label: 'Organisation name', canonical: 'organisationName' },
    { label: 'Where will the project take place?', canonical: 'deliveryArea' },
    { label: 'Total grant requested', canonical: null },
    { label: 'Total project cost', canonical: null },
  ],
}

describe('strictReading', () => {
  it('reads a figure written the way forms write figures', () => {
    expect(strictReading('amountRequested', '£24,000')).toBe('24000')
    expect(strictReading('amountRequested', '24000')).toBe('24000')
    expect(strictReading('amountRequested', '24,000.50')).toBe('24000.5')
  })

  it('refuses a figure with words in it, which coerceAmount would read as £24', () => {
    // The case that makes "also fill in the others" safe: an answer only a person can
    // read is left for a person, never applied as the digits it happens to contain.
    expect(strictReading('amountRequested', '24k over two years')).toBeNull()
    expect(strictReading('amountRequested', 'about fifteen thousand')).toBeNull()
    expect(strictReading('amountRequested', '')).toBeNull()
  })

  it('applies the field coercion to text fields', () => {
    expect(strictReading('applicantEmail', '  Team@Example.ORG ')).toBe('team@example.org')
    expect(strictReading('deliveryArea', 'Knowsley')).toBe('Knowsley')
  })
})

describe('canonicalFromApplication', () => {
  it('produces an input the create schema accepts, with nulls as absent', () => {
    const input = canonicalFromApplication(ROW)
    expect(input.amountRequested).toBeUndefined()
    expect(input.unrestrictedReserves).toBe(41000)
    expect(input.companyNumber).toBeUndefined()
    expect(CreateApplicationSchema.safeParse(input).success).toBe(true)
  })
})

describe('setField', () => {
  const input = canonicalFromApplication(ROW)

  it('turns a typed figure into a number, pound sign and commas and all', () => {
    const r = setField(input, 'amountRequested', '£58,000')
    expect(r.ok && r.input.amountRequested).toBe(58000)
  })

  it('refuses a figure that is not one', () => {
    const r = setField(input, 'amountRequested', '58k')
    expect(r.ok).toBe(false)
  })

  it('refuses an amount of nothing, which could never be shortlisted', () => {
    expect(setField(input, 'amountRequested', '0').ok).toBe(false)
  })

  it('clears a field on an empty value, except the organisation name', () => {
    const cleared = setField(input, 'deliveryArea', '  ')
    expect(cleared.ok && cleared.input.deliveryArea).toBeUndefined()
    expect(setField(input, 'organisationName', '').ok).toBe(false)
  })

  it('records what a field reads as, for the edit row', () => {
    expect(fieldText(input, 'deliveryArea')).toBe('Liverpool City Region')
    expect(fieldText(input, 'amountRequested')).toBeNull()
  })

  it('never offers the reference or the programme for editing', () => {
    expect(EDITABLE_FIELDS).not.toContain('externalApplicationId' as never)
    expect(EDITABLE_FIELDS).not.toContain('programmeName' as never)
  })
})

describe('moveAnswer', () => {
  const payload = {
    'Organisation name': 'The Lighthouse Youth Foundation',
    'Where will the project take place?': 'Liverpool City Region',
    'Total grant requested': '58k across the three years',
    'Total project cost': '£74,200',
  }
  const order = Object.keys(payload)

  it('takes the chosen answer out of the other answers and marks it as the field', () => {
    const r = moveAnswer({
      responses: ROW.responses,
      submittedFields: ROW.submittedFields,
      payload,
      order,
      field: 'amountRequested',
      consume: 'Total grant requested',
      release: null,
    })
    expect(r.responses.map((x) => x.label)).toEqual(['Total project cost'])
    expect(r.submittedFields?.find((f) => f.label === 'Total grant requested')?.canonical).toBe(
      'amountRequested',
    )
  })

  it('puts a released answer back where the applicant gave it', () => {
    // Pointing the amount at a different answer must never lose the first one.
    const r = moveAnswer({
      responses: [{ label: 'Total project cost', value: '£74,200' }],
      submittedFields: ROW.submittedFields.map((f) =>
        f.label === 'Total grant requested' ? { ...f, canonical: 'amountRequested' } : f,
      ),
      payload,
      order,
      field: 'amountRequested',
      consume: null,
      release: 'Total grant requested',
    })
    expect(r.responses.map((x) => x.label)).toEqual(['Total grant requested', 'Total project cost'])
    expect(
      r.submittedFields?.find((f) => f.label === 'Total grant requested')?.canonical,
    ).toBeNull()
  })

  it('releases a typed-over answer back among the others', () => {
    // Typing the area over "Liverpool City Region" leaves the applicant's own words on
    // the application, in their place, rather than silently dropping them.
    const r = moveAnswer({
      responses: ROW.responses,
      submittedFields: ROW.submittedFields,
      payload,
      order,
      field: 'deliveryArea',
      consume: null,
      release: 'Where will the project take place?',
    })
    expect(r.responses[0]).toEqual({
      label: 'Where will the project take place?',
      value: 'Liverpool City Region',
    })
  })
})

describe('rankAnswers', () => {
  const answers = [
    { label: 'Where will the work happen?', value: 'the North' },
    {
      label: 'Tell us about the young people',
      value:
        'Drop-ins across two estates for 11 to 18 year olds, run on weekday evenings through the school year.',
    },
    { label: 'Funding sought this round', value: '58k across the three years' },
    { label: 'Total project cost', value: '£74,200' },
  ]

  it("puts the mapper's own guess first and marks it likely", () => {
    const r = rankAnswers('amountRequested', answers, {
      sourceKey: 'Funding sought this round',
      confidence: 0.6,
    })
    expect(r[0]).toMatchObject({ label: 'Funding sought this round', likely: true })
    expect(r.filter((a) => a.likely)).toHaveLength(1)
  })

  it('then answers shaped like the field, in the order the applicant gave them', () => {
    const r = rankAnswers('amountRequested', answers, null)
    expect(r.map((a) => a.label)).toEqual([
      'Funding sought this round',
      'Total project cost',
      'Where will the work happen?',
      'Tell us about the young people',
    ])
    expect(r.some((a) => a.likely)).toBe(false)
  })

  it('reads a short place name as an area and a paragraph as not one', () => {
    expect(looksLike('deliveryArea', 'the North')).toBe(true)
    expect(looksLike('deliveryArea', answers[1]!.value)).toBe(false)
    expect(looksLike('deliveryArea', '£74,200')).toBe(false)
  })
})
