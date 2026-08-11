import { describe, it, expect } from 'vitest'
import { sortRows } from './sortRows'

/**
 * The derived listing tables (awards, reports, finance) sort here rather than in SQL,
 * so these tests are the only place the two kinds of table are held to the same rules.
 * Each one below is a rule `listApplications` gets from Postgres for free.
 */

type Row = { name: string; amount: number | null; paid: string | null }

const rows: Row[] = [
  { name: 'Beta Trust', amount: 500, paid: '2026-03-01' },
  { name: 'alpha Fund', amount: null, paid: null },
  { name: 'Gamma CIC', amount: 1200, paid: '2026-01-15' },
]

const keys = {
  name: (r: Row) => r.name,
  amount: (r: Row) => r.amount,
  paid: (r: Row) => r.paid,
}

const names = (out: Row[]) => out.map((r) => r.name)

describe('sortRows', () => {
  it('leaves the list alone when no column is sorted', () => {
    expect(sortRows(rows, undefined, keys)).toBe(rows)
    expect(sortRows(rows, { dir: 'asc' }, keys)).toBe(rows)
  })

  it('sorts text case-insensitively, like lower(name) in SQL', () => {
    // Not 'Beta', 'Gamma', 'alpha' — which is what a raw codepoint compare gives.
    expect(names(sortRows(rows, { by: 'name', dir: 'asc' }, keys))).toEqual([
      'alpha Fund',
      'Beta Trust',
      'Gamma CIC',
    ])
  })

  it('sorts numbers by value, not as strings', () => {
    expect(names(sortRows(rows, { by: 'amount', dir: 'desc' }, keys))).toEqual([
      'Gamma CIC',
      'Beta Trust',
      'alpha Fund',
    ])
  })

  it('keeps blanks last whichever way the arrow points', () => {
    // The whole point of NULLS LAST: flipping the sort should show the other end of the
    // real data, not a screenful of rows that have no value at all.
    expect(names(sortRows(rows, { by: 'paid', dir: 'asc' }, keys)).at(-1)).toBe('alpha Fund')
    expect(names(sortRows(rows, { by: 'paid', dir: 'desc' }, keys)).at(-1)).toBe('alpha Fund')
  })

  it('treats an empty string as blank', () => {
    const withEmpty = [{ name: '', amount: 1, paid: null }, ...rows]
    expect(names(sortRows(withEmpty, { by: 'name', dir: 'asc' }, keys)).at(-1)).toBe('')
  })

  it('falls back to the order the list arrived in', () => {
    // Equal keys keep their incoming order, so each screen's own default (newest first,
    // most-overdue first) survives as the tiebreak instead of an arbitrary one.
    const tied = [
      { name: 'Third', amount: 100, paid: null },
      { name: 'First', amount: 100, paid: null },
      { name: 'Second', amount: 100, paid: null },
    ]
    expect(names(sortRows(tied, { by: 'amount', dir: 'desc' }, keys))).toEqual([
      'Third',
      'First',
      'Second',
    ])
  })

  it("does not mutate the caller's rows", () => {
    const before = [...rows]
    sortRows(rows, { by: 'name', dir: 'asc' }, keys)
    expect(rows).toEqual(before)
  })
})
