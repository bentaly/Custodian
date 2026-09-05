import { or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * What a list screen's search box means in SQL: "any of these columns CONTAINS this,
 * case-insensitively".
 *
 * Shared because the five list screens had four different answers. Awards escaped the
 * needle; Applications and Partnerships did not, so a search for `50%` or `E2E_LK`
 * silently became a wildcard — `%` matches the rest of the row and `_` matches any
 * character, which turns a search that found nothing into one that finds everything.
 * Applications also promised more than it delivered: the box says "organisation or ID"
 * and the query only ever looked at the name, so no reference ever matched.
 *
 * `\` is escaped first and is the escape character, which Postgres' `LIKE` uses by
 * default. A NULL column simply never matches, which is what you want: a grant with no
 * reference is not a grant whose reference is the empty string.
 */
export function searchAny(term: string | undefined, ...columns: SQLWrapper[]): SQL | undefined {
  const needle = term?.trim()
  if (!needle || columns.length === 0) return undefined
  const like = `%${needle.replace(/[\\%_]/g, '\\$&')}%`
  const clauses = columns.map((c) => sql`${c} ilike ${like}`)
  return clauses.length === 1 ? clauses[0]! : or(...clauses)
}
