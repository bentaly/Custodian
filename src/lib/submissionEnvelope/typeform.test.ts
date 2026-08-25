import { describe, it, expect } from 'vitest'
import { flattenTypeform, isTypeformEnvelope } from './typeform'
import { readEnvelope } from './index'

/** A Typeform webhook envelope, trimmed to the parts this module reads. */
function envelope(over: {
  fields?: { id: string; title?: string; ref?: string }[]
  answers?: Record<string, unknown>[]
  hidden?: Record<string, unknown>
  token?: string
  title?: string
}) {
  return {
    event_id: 'evt_1',
    event_type: 'form_response',
    form_response: {
      form_id: 'WCuZJDce',
      token: over.token ?? 'mp7covg84tj1nvjbq3cdmp7jhlr7dtdm',
      submitted_at: '2026-08-25T09:00:00Z',
      definition: {
        id: 'WCuZJDce',
        title: over.title ?? 'Long-Term Local Partnerships',
        fields: over.fields ?? [],
      },
      ...(over.hidden ? { hidden: over.hidden } : {}),
      answers: over.answers ?? [],
    },
  }
}

const answer = (id: string, body: Record<string, unknown>) => ({
  ...body,
  field: { id, type: 'short_text', ref: `ref_${id}` },
})

describe('isTypeformEnvelope', () => {
  it('recognises an envelope by shape', () => {
    expect(isTypeformEnvelope(envelope({}))).toBe(true)
  })

  it('leaves an ordinary flat payload alone', () => {
    // The everyday case: a foundation posting canonical-ish field names by hand.
    const flat = { organisationName: 'Rivergate Trust', amountRequested: '25000' }
    expect(isTypeformEnvelope(flat)).toBe(false)
    expect(readEnvelope(flat)).toBeNull()
  })

  it('is not fooled by a form field literally called form_response', () => {
    expect(isTypeformEnvelope({ form_response: 'yes please' })).toBe(false)
  })
})

describe('flattenTypeform', () => {
  it('joins questions to answers on field id', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [
          { id: 'a1', title: 'Organisation name' },
          { id: 'a2', title: 'How much are you requesting?' },
        ],
        answers: [
          answer('a1', { type: 'text', text: 'Rivergate Trust' }),
          answer('a2', { type: 'number', number: 25000 }),
        ],
      }),
    )
    expect(flat).toMatchObject({
      'Organisation name': 'Rivergate Trust',
      'How much are you requesting?': 25000,
    })
  })

  it('reads every answer type by its own key', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [
          { id: 'a1', title: 'Email' },
          { id: 'a2', title: 'Registered?' },
          { id: 'a3', title: 'Start date' },
          { id: 'a4', title: 'Website' },
          { id: 'a5', title: 'Phone' },
          { id: 'a6', title: 'Budget upload' },
        ],
        answers: [
          answer('a1', { type: 'email', email: 'grants@rivergate.org' }),
          answer('a2', { type: 'boolean', boolean: true }),
          answer('a3', { type: 'date', date: '2026-09-01' }),
          answer('a4', { type: 'url', url: 'https://rivergate.org' }),
          answer('a5', { type: 'phone_number', phone_number: '+441234567890' }),
          answer('a6', { type: 'file_url', file_url: 'https://api.typeform.com/x/budget.xlsx' }),
        ],
      }),
    )
    expect(flat).toMatchObject({
      Email: 'grants@rivergate.org',
      'Registered?': true,
      'Start date': '2026-09-01',
      Website: 'https://rivergate.org',
      Phone: '+441234567890',
      'Budget upload': 'https://api.typeform.com/x/budget.xlsx',
    })
  })

  it('takes the label from a single choice, and the free text when "other" was used', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [
          { id: 'a1', title: 'Which programme?' },
          { id: 'a2', title: 'How did you hear about us?' },
        ],
        answers: [
          answer('a1', { type: 'choice', choice: { label: 'Local Partnerships' } }),
          answer('a2', { type: 'choice', choice: { other: 'A trustee mentioned it' } }),
        ],
      }),
    )
    expect(flat).toMatchObject({
      'Which programme?': 'Local Partnerships',
      'How did you hear about us?': 'A trustee mentioned it',
    })
  })

  it('joins a multi-select into the comma list a person would have typed', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [{ id: 'a1', title: 'Themes' }],
        answers: [
          answer('a1', {
            type: 'choices',
            choices: { labels: ['Youth', 'Mental health'], other: 'Housing' },
          }),
        ],
      }),
    )
    expect(flat!.Themes).toBe('Youth, Mental health, Housing')
  })

  it('supplies the response id as "Submission ID"', () => {
    // externalApplicationId is REQUIRED and a form almost never asks for a reference,
    // so without this every webhook submission would hold at needs_review. The name is
    // chosen to hit the built-in dictionary's "submission id" alias.
    const flat = flattenTypeform(
      envelope({
        token: 'resp_abc123',
        fields: [{ id: 'a1', title: 'Organisation name' }],
        answers: [answer('a1', { type: 'text', text: 'Rivergate Trust' })],
      }),
    )
    expect(flat!['Submission ID']).toBe('resp_abc123')
    expect(flat!['Form name']).toBe('Long-Term Local Partnerships')
    expect(flat!['Submitted at']).toBe('2026-08-25T09:00:00Z')
  })

  it('lets a hidden field override a synthesised key', () => {
    // A hidden field is something the foundation deliberately put on the URL, so it is
    // a more specific statement of intent than anything we inferred from the envelope.
    const flat = flattenTypeform(
      envelope({
        hidden: { 'Form name': 'Local Partnerships 2026', utm_source: 'newsletter' },
        fields: [{ id: 'a1', title: 'Organisation name' }],
        answers: [answer('a1', { type: 'text', text: 'Rivergate Trust' })],
      }),
    )
    expect(flat!['Form name']).toBe('Local Partnerships 2026')
    expect(flat!.utm_source).toBe('newsletter')
  })

  it('keeps both answers when two questions share a title', () => {
    // Last-write-wins would lose one answer with nothing anywhere saying so — the
    // lost-field failure the tier system exists to prevent, arriving before the mapper.
    const flat = flattenTypeform(
      envelope({
        fields: [
          { id: 'a1', title: 'Amount' },
          { id: 'a2', title: 'Amount' },
        ],
        answers: [
          answer('a1', { type: 'number', number: 25000 }),
          answer('a2', { type: 'number', number: 40000 }),
        ],
      }),
    )
    expect(flat!.Amount).toBe(25000)
    expect(flat!['Amount (2)']).toBe(40000)
  })

  it('falls back to the field ref when a question has no title', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [{ id: 'a1' }],
        answers: [answer('a1', { type: 'boolean', boolean: true })],
      }),
    )
    expect(flat!.ref_a1).toBe(true)
  })

  it('collapses whitespace in a question title', () => {
    // Titles wrap in the Typeform editor; the lookup table is keyed on one line.
    const flat = flattenTypeform(
      envelope({
        fields: [{ id: 'a1', title: 'Where are you based\n  and where do you help?' }],
        answers: [answer('a1', { type: 'text', text: 'Sheffield' })],
      }),
    )
    expect(flat!['Where are you based and where do you help?']).toBe('Sheffield')
  })

  it('drops empty answers rather than mapping a blank', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [
          { id: 'a1', title: 'Organisation name' },
          { id: 'a2', title: 'Charity number' },
        ],
        answers: [
          answer('a1', { type: 'text', text: 'Rivergate Trust' }),
          answer('a2', { type: 'text', text: '' }),
        ],
      }),
    )
    expect(flat).not.toHaveProperty('Charity number')
  })

  it('preserves an unrecognised answer shape as JSON rather than dropping it', () => {
    const flat = flattenTypeform(
      envelope({
        fields: [{ id: 'a1', title: 'Rank these' }],
        answers: [answer('a1', { type: 'ranking', ranking: [{ label: 'Youth' }] })],
      }),
    )
    expect(flat!['Rank these']).toBe('[{"label":"Youth"}]')
  })

  it('returns null for an envelope with no answers at all', () => {
    // Typeform's "test" delivery. The caller then answers 400 rather than saving an
    // ingest row holding nothing but the response id.
    expect(readEnvelope(envelope({ answers: [] }))).toBeNull()
  })
})

describe('readEnvelope', () => {
  it('reports the platform alongside the flattened payload', () => {
    const result = readEnvelope(
      envelope({
        fields: [{ id: 'a1', title: 'Organisation name' }],
        answers: [answer('a1', { type: 'text', text: 'Rivergate Trust' })],
      }),
    )
    expect(result?.platform).toBe('typeform')
    expect(result?.payload['Organisation name']).toBe('Rivergate Trust')
  })
})
