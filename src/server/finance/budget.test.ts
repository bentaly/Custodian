import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from '../../../drizzle/schema'
import type { getDb } from '../db'
import { budgetPanelQueries, ownedProgrammes } from './budget'
import { financialYear } from '../../lib/financialYear'

/**
 * The balance-and-budget panel's tenant scope, asserted on the SQL Drizzle emits.
 *
 * The sibling `query.test.ts` records why this matters: Finance's grants query once
 * carried a raw `or` inside an `and()`, which escaped its own term and re-associated the
 * whole WHERE so the scope constrained one branch only — every foundation's grants
 * appeared on every other foundation's screen. This panel reads a foundation's **bank
 * balance**, so the same mistake here is worse.
 *
 * Every query is scoped by `client_id` alone (no round-programme scope: a balance and a
 * budget are one tenant's, and a clientless superadmin gets no panel at all). So the
 * invariants are exactly two, and both are structural rather than "the parameter appears
 * somewhere in the string" — it appeared in the leak too, on the wrong side of an OR.
 *
 * Nothing connects: `.toSQL()` only renders. The client is built here rather than via
 * `getDb()` because `neon()` validates the connection string on construction.
 */
function offlineDb(): ReturnType<typeof getDb> {
  return drizzle(neon('postgresql://user:pass@host.tld/db'), { schema })
}

const CLIENT = '11111111-1111-1111-1111-111111111111'
const FY = financialYear(3, new Date('2026-08-30T12:00:00Z'))

/** The WHERE of the outermost statement — everything after the last top-level `where`. */
function outerWhere(sql: string): string {
  const i = sql.lastIndexOf(' where ')
  expect(i).toBeGreaterThan(-1)
  return sql.slice(i + ' where '.length)
}

/** Strip a bracket pair that encloses the whole clause — Drizzle's `and()` adds one. */
function unwrap(clause: string): string {
  let c = clause.trim()
  while (c.startsWith('(')) {
    let depth = 0
    let closesAtEnd = false
    for (let i = 0; i < c.length; i++) {
      if (c[i] === '(') depth++
      else if (c[i] === ')') {
        depth--
        if (depth === 0) {
          closesAtEnd = i === c.length - 1
          break
        }
      }
    }
    if (!closesAtEnd) break
    c = c.slice(1, -1).trim()
  }
  return c
}

/** The clause with every bracketed span blanked out, leaving only its top level. */
function topLevel(clause: string): string {
  let depth = 0
  let out = ''
  for (const ch of unwrap(clause)) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else out += depth === 0 ? ch : ' '
    if (ch === '(' || ch === ')') out += ' '
  }
  return out
}

/**
 * Is there an `or` at the top level of this clause?
 *
 * A bracketed `or` is fine — the whole point is that a naked one re-associates the
 * conjunction around it, which is how the scope filter ended up on one branch only.
 */
function hasTopLevelOr(clause: string): boolean {
  return /\bor\b/i.test(topLevel(clause))
}

describe('budgetPanelQueries', () => {
  const queries = budgetPanelQueries(offlineDb(), CLIENT, FY)
  const rendered = queries.map((q) => q.toSQL())

  it('builds the five statements the panel is assembled from', () => {
    expect(rendered).toHaveLength(5)
  })

  it.each([
    ['bank balance', 0, 'bank_balance_readings'],
    ['annual budget', 1, 'annual_budgets'],
    ['awards this year', 2, 'awards'],
    ['outstanding total', 3, 'awards'],
    ['outstanding buckets', 4, 'award_instalments'],
  ])('scopes the %s query to one client', (_name, index, table) => {
    const { sql, params } = rendered[index]!
    expect(sql).toContain(table)
    expect(sql).toContain('"client_id" =')
    // The tenant reaches the database as a bound parameter, never interpolated.
    expect(params).toContain(CLIENT)
  })

  it.each([0, 1, 2, 3, 4])('keeps statement %i a conjunction with no top-level or', (index) => {
    expect(hasTopLevelOr(outerWhere(rendered[index]!.sql))).toBe(false)
  })

  it('never interpolates the client id into the SQL text', () => {
    for (const { sql } of rendered) expect(sql).not.toContain(CLIENT)
  })

  it('bounds the award cohort by the financial year, upper bound exclusive', () => {
    const { sql, params } = rendered[2]!
    expect(sql).toContain('"decision_at" >=')
    // `< (end + 1)` rather than `<= end`: `decision_at` is a timestamp, so an award
    // decided at 14:00 on the last day of the year must still be inside it.
    expect(sql).toContain('+ 1')
    expect(params).toContain(FY.start)
    expect(params).toContain(FY.end)
  })

  it('excludes cancelled grants from both outstanding queries', () => {
    for (const index of [3, 4]) {
      const { sql, params } = rendered[index]!
      expect(sql).toContain('"status" <>')
      expect(params).toContain('cancelled')
    }
  })

  it('counts paid instalments in the outstanding buckets but never unpaid ones as paid', () => {
    // The bucket query is about what is STILL owed, so it must filter to unpaid rows.
    expect(rendered[4]!.sql).toContain('"paid_date" is null')
  })

  it('takes only the newest balance reading, latest as-at date first', () => {
    const { sql } = rendered[0]!
    expect(sql).toContain('order by')
    expect(sql).toContain('"as_at_date" desc')
    // The tiebreak that makes a same-day correction win over the figure it corrects.
    expect(sql).toContain('"created_at" desc')
    expect(sql).toContain('limit')
  })

  it('finds the budget by date containment rather than by a recomputed year', () => {
    const { params } = rendered[1]!
    // Today, twice — start <= today <= end — so a budget saved under a previous
    // year-end setting is still found under its own stored dates.
    const today = new Date().toISOString().slice(0, 10)
    expect(params.filter((p) => p === today)).toHaveLength(2)
  })
})

/**
 * The ownership check `saveAnnualBudget` runs before writing a programme line.
 *
 * A regression test with a specific cause. This was first written as a raw
 * ``sql`${programmes.id} = any(${ids})` ``, which typechecks and then fails at runtime —
 * Drizzle expands a JS array inside an `sql` template into a parameter LIST, so Postgres
 * gets `any(($2, $3, $4))` and refuses it ("op ANY/ALL (array) requires array on right
 * side", SQLSTATE 42809). Nothing caught it until the form was actually submitted,
 * because every unit test around it wrote its rows directly.
 */
describe('ownedProgrammes', () => {
  const ids = ['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333']
  const { sql, params } = ownedProgrammes(offlineDb(), CLIENT, ids).toSQL()

  it('renders an in-list, never a scalar-list any()', () => {
    expect(sql).toContain('"id" in (')
    expect(sql).not.toContain('any(')
  })

  it('scopes to the tenant as well as the ids', () => {
    expect(sql).toContain('"client_id" =')
    expect(params).toContain(CLIENT)
    for (const id of ids) expect(params).toContain(id)
  })

  it('keeps the clause a conjunction', () => {
    expect(hasTopLevelOr(outerWhere(sql))).toBe(false)
  })
})
