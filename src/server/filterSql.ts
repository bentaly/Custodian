import { inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * What a multi-select filter pill means in SQL — the twin of `lib/filterSelection`, which
 * states the rule: OR within one pill, AND across pills (the caller's `and(...)`), and no
 * selection is no clause at all.
 *
 * Shared because five list screens each turned a pill into a where-clause, and the one
 * way to be sure a theme filter means "any of these" everywhere is for there to be one
 * function that says so.
 */

/** A column holding one value per row: the row's value is any of those selected. */
export function anyOf(column: SQLWrapper, values: readonly string[] | undefined): SQL | undefined {
  // Empty is handled here rather than trusted to the validator: `inArray(x, [])` is a
  // SQL error in drizzle.
  return values?.length ? inArray(column as SQL, [...values]) : undefined
}

/**
 * A jsonb array of themes: the row carries AT LEAST ONE of those selected. Never "all of
 * them", which empties the list the moment a second theme is ticked.
 */
export function anyTag(column: SQLWrapper, values: readonly string[] | undefined): SQL | undefined {
  if (!values?.length) return undefined
  const clauses = values.map((v) => sql`${column} @> ${JSON.stringify([v])}::jsonb`)
  return clauses.length === 1 ? clauses[0]! : or(...clauses)
}

/**
 * As `anyOf`, where one option is a SENTINEL for "no value" rather than a value — the
 * Location pill's `NO_REGION`. Ticked alongside real regions it widens the match to the
 * NULL rows as well; it is never compared as a string.
 */
export function anyOfOrNull(
  column: SQLWrapper,
  values: readonly string[] | undefined,
  nullSentinel: string,
): SQL | undefined {
  if (!values?.length) return undefined
  const named = values.filter((v) => v !== nullSentinel)
  const clauses = [
    ...(named.length ? [inArray(column as SQL, named)] : []),
    ...(values.includes(nullSentinel) ? [isNull(column as SQL)] : []),
  ]
  return clauses.length === 1 ? clauses[0]! : or(...clauses)
}
