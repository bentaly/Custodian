import { describe, expect, it } from 'vitest'
import { budgetTotal, parseBudgetBreakdown } from './parse'
import { formatPounds } from './format'

describe('parseBudgetBreakdown', () => {
  it('parses an array of line objects', () => {
    expect(
      parseBudgetBreakdown([
        { item: 'Staff costs', amount: 22000 },
        { item: 'Venue hire', amount: 3000 },
      ]),
    ).toEqual([
      { item: 'Staff costs', amount: 22000 },
      { item: 'Venue hire', amount: 3000 },
    ])
  })

  it('parses the JSON-string form the ingest pipeline produces', () => {
    // toStringValue JSON.stringifies any structured payload value before it
    // reaches a canonical slot, so this is the shape that actually arrives.
    expect(parseBudgetBreakdown('[{"item":"Materials","amount":1500}]')).toEqual([
      { item: 'Materials', amount: 1500 },
    ])
  })

  it('accepts alternative key names and formatted amounts', () => {
    expect(
      parseBudgetBreakdown([
        { category: 'Staff', value: '£22,000' },
        { label: 'Transport', total: '1,250.50' },
      ]),
    ).toEqual([
      { item: 'Staff', amount: 22000 },
      { item: 'Transport', amount: 1250.5 },
    ])
  })

  it('keeps decimal amounts to the penny', () => {
    expect(parseBudgetBreakdown([{ item: 'Staff', amount: '£1,250.50' }])).toEqual([
      { item: 'Staff', amount: 1250.5 },
    ])
  })

  it('handles the Item / Description / Cost form shape (case-insensitive keys)', () => {
    // The real the7stars budget table — capitalised column names, Cost as the
    // amount, Description preserved as a detail.
    expect(
      parseBudgetBreakdown([{ Item: 'Staff costs', Description: '2 FTE for 12 months', Cost: '£22,000' }]),
    ).toEqual([
      {
        item: 'Staff costs',
        amount: 22000,
        details: [{ label: 'Description', value: '2 FTE for 12 months' }],
      },
    ])
  })

  it('preserves extra fields on a line as details', () => {
    expect(
      parseBudgetBreakdown([
        { item: 'Staff', amount: 22000, costType: 'revenue', note: '2 FTE for 12 months' },
      ]),
    ).toEqual([
      {
        item: 'Staff',
        amount: 22000,
        details: [
          { label: 'costType', value: 'revenue' },
          { label: 'note', value: '2 FTE for 12 months' },
        ],
      },
    ])
  })

  it('does not treat the item/amount keys as details, and drops empty extras', () => {
    const [line] = parseBudgetBreakdown([{ item: 'Staff', amount: 100, blank: '', note: 'x' }])!
    expect(line!.details).toEqual([{ label: 'note', value: 'x' }])
  })

  it('parses a flat category → amount map', () => {
    expect(parseBudgetBreakdown({ Staff: 22000, Venue: '£3,000' })).toEqual([
      { item: 'Staff', amount: 22000 },
      { item: 'Venue', amount: 3000 },
    ])
  })

  it('resolves `cost` as the figure or the label depending on the sibling keys', () => {
    expect(parseBudgetBreakdown([{ item: 'Venue', cost: 500 }])).toEqual([
      { item: 'Venue', amount: 500 },
    ])
    expect(parseBudgetBreakdown([{ cost: 'Venue', amount: 500 }])).toEqual([
      { item: 'Venue', amount: 500 },
    ])
  })

  it('skips lines missing a label or a usable amount', () => {
    expect(
      parseBudgetBreakdown([
        { item: 'Staff', amount: 22000 },
        { item: 'Unpriced' },
        { amount: 900 },
        { item: 'Free', amount: 0 },
      ]),
    ).toEqual([{ item: 'Staff', amount: 22000 }])
  })

  it('returns null for free text, so the caller keeps it as a response', () => {
    expect(parseBudgetBreakdown('We expect to spend about £22,000 on staff.')).toBeNull()
    expect(parseBudgetBreakdown('')).toBeNull()
    expect(parseBudgetBreakdown('{ not json')).toBeNull()
    expect(parseBudgetBreakdown(22000)).toBeNull()
    expect(parseBudgetBreakdown(null)).toBeNull()
  })

  it('returns null when nothing in the structure is a budget line', () => {
    expect(parseBudgetBreakdown([{ note: 'see attached' }])).toBeNull()
    expect(parseBudgetBreakdown({ summary: 'see attached' })).toBeNull()
    expect(parseBudgetBreakdown([])).toBeNull()
  })
})

describe('budgetTotal', () => {
  it('sums the lines', () => {
    expect(budgetTotal([{ item: 'a', amount: 100 }, { item: 'b', amount: 250.5 }])).toBe(350.5)
  })

  it('is zero for no lines', () => {
    expect(budgetTotal([])).toBe(0)
  })
})

describe('formatPounds', () => {
  it('omits pence for whole pounds and shows them otherwise', () => {
    expect(formatPounds(22000)).toBe('£22,000')
    expect(formatPounds(1250.5)).toBe('£1,250.50')
    expect(formatPounds(1250.05)).toBe('£1,250.05')
  })
})
