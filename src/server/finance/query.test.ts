import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from '../../../drizzle/schema'
import type { getDb } from '../db'
import { financeDates, grantsQuery, tabWhere } from './query'

/**
 * The Finance list's tenant scope, asserted on the SQL Drizzle actually emits.
 *
 * This exists because of a real cross-tenant leak. `grantsQuery` builds its WHERE with
 * `and(status, cancelledRule, scope)`, and the cancelled rule was a raw template
 * carrying a bare `or`:
 *
 *     sql`${awards.status} <> 'cancelled' or coalesce(${roll.paidTotal}, 0) > 0`
 *
 * `and()` brackets the whole list but NOT each member, so the `or` escaped its own term
 * and `AND`'s tighter binding re-associated the clause into
 *
 *     (applications.status = 'awarded' AND awards.status <> 'cancelled')
 *     OR (paid_total > 0 AND round_programme_id IN <scope>)
 *
 * — leaving the scope on one branch only. Every foundation's awarded grants appeared on
 * every other foundation's Finance screen, and `includeBankDetails` puts account name,
 * sort code and full account number in the CSV export.
 *
 * A test that only asserted "the scope parameters appear in the SQL" would have passed
 * throughout: they did appear, on the wrong side of an OR. So the invariant asserted
 * here is structural — the grants WHERE is a conjunction with **no disjunction at its
 * top level**, which is the only shape in which the scope constrains every row.
 *
 * The client is built here rather than through `getDb()`: `neon()` validates the shape
 * of the connection string on construction, so `getDb()`'s no-DATABASE_URL fallback
 * throws. Nothing connects and nothing runs — `.toSQL()` only renders.
 */

/** A driver-shaped client that never opens a connection; `.toSQL()` asks nothing of it. */
function offlineDb(): ReturnType<typeof getDb> {
  return drizzle(neon('postgresql://user:pass@host.tld/db'), { schema })
}

/** The body of the `grants` subquery — `from ( … ) "grants"` in the emitted SQL. */
function grantsSubquery(fullSql: string): string {
  const start = fullSql.indexOf('from (')
  expect(start, 'expected a `from (` opening the grants subquery').toBeGreaterThan(-1)
  const open = fullSql.indexOf('(', start)
  let depth = 0
  for (let i = open; i < fullSql.length; i++) {
    if (fullSql[i] === '(') depth++
    else if (fullSql[i] === ')') {
      depth--
      if (depth === 0) return fullSql.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced parentheses in emitted SQL')
}

/**
 * Every `or` sitting at the top level of the grants WHERE — i.e. inside the single
 * bracket `and()` emits, but not nested any deeper. Empty means the clause is a pure
 * conjunction and each member, the scope included, constrains every row.
 *
 * The subquery's own `filter (where …)` aggregates are nested deeper and so are ignored,
 * which is why this counts depth rather than matching text.
 */
function topLevelOrs(grantsWhere: string): number {
  let depth = 0
  let found = 0
  for (let i = 0; i < grantsWhere.length; i++) {
    const c = grantsWhere[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    // `and()` wraps its members in one bracket, so a member sits at depth 1.
    else if (depth === 1 && grantsWhere.startsWith(' or ', i)) found++
  }
  return found
}

/** The grants subquery's own WHERE — the last one at the body's own bracket depth. */
function grantsWhere(fullSql: string): string {
  const body = grantsSubquery(fullSql)
  let depth = 0
  let at = -1
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++
    else if (body[i] === ')') depth--
    else if (depth === 0 && body.startsWith(' where ', i)) at = i
  }
  expect(at, 'expected a WHERE on the grants subquery').toBeGreaterThan(-1)
  return body.slice(at + ' where '.length)
}

const SCOPE = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']

function emitted(scope: string[] | null): { sql: string; params: unknown[] } {
  const db = offlineDb()
  const g = grantsQuery(db, scope, financeDates())
  return db.select().from(g).where(tabWhere(g, 'to_pay')).toSQL()
}

describe('grantsQuery tenant scope', () => {
  it('constrains every row by scope — no top-level OR to escape through', () => {
    const where = grantsWhere(emitted(SCOPE).sql)
    expect(topLevelOrs(where)).toBe(0)
  })

  it('puts the scoped round-programme ids in the query', () => {
    const { sql, params } = emitted(SCOPE)
    expect(sql).toContain('"applications"."round_programme_id" in')
    for (const id of SCOPE) expect(params).toContain(id)
  })

  it('brackets the cancelled-grant rule, so its OR cannot re-associate the clause', () => {
    // The specific regression: the raw template must carry its own parentheses.
    expect(emitted(SCOPE).sql).toContain(`("awards"."status" <> 'cancelled' or coalesce(`)
  })

  it('omits the scope entirely for a superadmin, and is still a pure conjunction', () => {
    const { sql, params } = emitted(null)
    expect(sql).not.toContain('"applications"."round_programme_id" in')
    for (const id of SCOPE) expect(params).not.toContain(id)
    expect(topLevelOrs(grantsWhere(sql))).toBe(0)
  })

  it('the depth scanner actually detects the shape that leaked', () => {
    // Guards the guard: the pre-fix clause, verbatim, must be reported.
    const leaked =
      `("applications"."status" = $7 and "awards"."status" <> 'cancelled'` +
      ` or coalesce("paid_total", 0) > 0 and "applications"."round_programme_id" in ($8, $9))`
    expect(topLevelOrs(leaked)).toBe(1)
  })
})
