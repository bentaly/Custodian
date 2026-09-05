import { describe, it, expect } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { searchAny } from './searchTerm'

// What a list screen's search box compiles to. The escaping is the part worth pinning:
// three of the five screens used to interpolate the term straight into a LIKE pattern,
// so a reference containing `_` matched any character and one containing `%` matched
// the rest of the row — a search that should have found one grant found all of them.

const NAME = sql`"organisation_name"`
const REF = sql`"external_application_id"`
const dialect = new PgDialect()

/** The SQL and the bound parameters, as Postgres would receive them. */
function compile(clause: SQL | undefined) {
  if (!clause) throw new Error('expected a clause')
  const q = dialect.sqlToQuery(clause)
  return { sql: q.sql, params: q.params }
}

describe('searchAny', () => {
  it('is absent for an empty or whitespace-only term, so it never narrows anything', () => {
    expect(searchAny(undefined, NAME)).toBeUndefined()
    expect(searchAny('', NAME)).toBeUndefined()
    expect(searchAny('   ', NAME)).toBeUndefined()
  })

  it('takes no columns to mean nothing to search', () => {
    expect(searchAny('oxfam')).toBeUndefined()
  })

  it('matches "contains, case-insensitively"', () => {
    const { sql: text, params } = compile(searchAny('oxfam', NAME))
    expect(text).toContain('ilike')
    expect(params).toEqual(['%oxfam%'])
  })

  it('trims, so a stray space off a paste still matches', () => {
    expect(compile(searchAny('  oxfam  ', NAME)).params).toEqual(['%oxfam%'])
  })

  it('escapes LIKE wildcards in the term — the bug this helper exists for', () => {
    // `%` would otherwise match the rest of the value, `_` any single character.
    expect(compile(searchAny('50%', NAME)).params).toEqual(['%50\\%%'])
    expect(compile(searchAny('E2E_LK', NAME)).params).toEqual(['%E2E\\_LK%'])
    // The escape character itself goes first, or it would eat the one after it.
    expect(compile(searchAny('a\\b', NAME)).params).toEqual(['%a\\\\b%'])
  })

  it('ORs across every column it is given, each bound separately', () => {
    const { sql: text, params } = compile(searchAny('oxfam', NAME, REF))
    expect(text).toContain(' or ')
    expect(params).toEqual(['%oxfam%', '%oxfam%'])
  })
})
