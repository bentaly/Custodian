import { describe, expect, it } from 'vitest'
import { buildSubmittedFields, computeResponses, orderedKeys, PROVIDED } from './assemble'

// The order a submission was made in is destroyed the moment it is stored: Postgres
// normalises jsonb object keys by length and then bytewise, so `raw_payload` hands
// back a form's questions shortest-first, in an order no applicant ever saw. What is
// stored on the ingest as `field_order` is the only record of the real one. These
// tests pin the reconciliation between the two, because a regression here is silent —
// the fields are all present, just in the wrong sequence, which is exactly what made
// the original problem take so long to notice.

// The payload as it comes back from jsonb: sorted by key length, not by form order.
const PAYLOAD = {
  Trustees: '9',
  'Contact name': 'Jo Patel',
  'Funding title': 'Winter warmth',
  'Organisation name': 'Fenland Food Network',
  'Why is this funding needed and how has the need been identified?': 'Because…',
}
// The order the applicant actually filled it in.
const FIELD_ORDER = [
  'Organisation name',
  'Contact name',
  'Funding title',
  'Why is this funding needed and how has the need been identified?',
  'Trustees',
]

describe('orderedKeys', () => {
  it('restores the submitted order over the payload’s stored order', () => {
    expect(orderedKeys(PAYLOAD, FIELD_ORDER)).toEqual(FIELD_ORDER)
  })

  it('leaves the payload alone when no order was captured', () => {
    // Every row promoted before `field_order` existed. Their order is not
    // recoverable, and guessing one would be worse than keeping what is there.
    expect(orderedKeys(PAYLOAD, null)).toEqual(Object.keys(PAYLOAD))
    expect(orderedKeys(PAYLOAD, [])).toEqual(Object.keys(PAYLOAD))
  })

  it('drops keys the order names but the payload no longer has', () => {
    expect(orderedKeys({ b: 1 }, ['a', 'b'])).toEqual(['b'])
  })

  it('keeps keys the order never mentioned, after the ones it did', () => {
    // Never expected, but a field that arrived and is not rendered is the lost-field
    // failure again — so an incomplete order loses nothing.
    expect(orderedKeys({ a: 1, b: 2, c: 3 }, ['c'])).toEqual(['c', 'a', 'b'])
  })

  it('ignores a duplicated key in the order', () => {
    expect(orderedKeys({ a: 1, b: 2 }, ['a', 'a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('computeResponses', () => {
  it('returns the leftovers in submitted order', () => {
    const resolved = {
      organisationName: { sourceKey: 'Organisation name', value: 'Fenland Food Network' },
    }
    expect(computeResponses(PAYLOAD, resolved, FIELD_ORDER).map((r) => r.label)).toEqual([
      'Contact name',
      'Funding title',
      'Why is this funding needed and how has the need been identified?',
      'Trustees',
    ])
  })
})

describe('buildSubmittedFields', () => {
  const resolved = {
    organisationName: { sourceKey: 'Organisation name', value: 'Fenland Food Network' },
    // Typed by a reviewer rather than pointed at an incoming field: it consumed no
    // payload key, so it has no place in the submission's running order.
    charityNumber: { sourceKey: PROVIDED, value: '1122334' },
  }

  it('indexes every submitted field, in order, naming what it fed', () => {
    expect(buildSubmittedFields(PAYLOAD, resolved, FIELD_ORDER)).toEqual([
      { label: 'Organisation name', canonical: 'organisationName' },
      { label: 'Contact name', canonical: null },
      { label: 'Funding title', canonical: null },
      {
        label: 'Why is this funding needed and how has the need been identified?',
        canonical: null,
      },
      { label: 'Trustees', canonical: null },
    ])
  })

  it('marks a field the payload named canonically, even with nothing pointing at it', () => {
    // `applyLookupOver` resolves these on the key alone, so `resolved` records no
    // source key for them. Indexed as a plain response they would be looked up in
    // `responses` — which never holds a canonical key — and vanish from the dialog.
    expect(buildSubmittedFields({ applicantEmail: 'jo@example.org' }, {}, null)).toEqual([
      { label: 'applicantEmail', canonical: 'applicantEmail' },
    ])
  })

  it('omits fields that arrived empty', () => {
    expect(buildSubmittedFields({ a: '', b: 'x' }, {}, ['a', 'b'])).toEqual([
      { label: 'b', canonical: null },
    ])
  })
})
