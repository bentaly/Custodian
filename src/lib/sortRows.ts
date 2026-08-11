/**
 * Column sort for the DERIVED listing tables — awards, reports, finance.
 *
 * Those lists are built and ordered in memory inside their server fn rather than in
 * SQL (see `src/lib/pagination.ts` for why: a report row is an award's schedule crossed
 * with what has arrived, a finance row is instalments rolled up — neither can be
 * `ORDER BY`'d before it exists). So a sortable column there is a comparator, not a
 * query. It still happens on the server, and still before `paginate`, so page 2 is the
 * second page of the sort rather than the old order re-sorted a screenful at a time.
 *
 * The rules are chosen to match what `listApplications` gets from Postgres, so the two
 * kinds of table cannot behave differently under the same arrow:
 *
 * - **Blanks sort last in BOTH directions** — SQL's `NULLS LAST`. A grant with no
 *   payment date is not the earliest one; flipping the arrow should surface the other
 *   end of the real data, not parade the unknowns.
 * - **Text compares case-insensitively**, like the `lower(organisation_name)` the
 *   applications query sorts on.
 * - **The list's own order is the tiebreak.** `Array#sort` is stable, so rows a key
 *   cannot separate stay in the order the fn built them in (newest first, most-overdue
 *   first…) rather than an arbitrary one.
 *
 * Categorical columns (a status pill) pass a rank rather than the label — sorting
 * lifecycle states alphabetically is meaningless, which is why the applications query
 * spells its own order out in a `CASE`.
 */

export type SortDir = 'asc' | 'desc'

export type SortValue = string | number | Date | null | undefined

/** Empty string counts as absent: a blank cell and a NULL read the same on screen. */
function comparable(value: SortValue): string | number | null {
  if (value == null || value === '') return null
  return value instanceof Date ? value.getTime() : value
}

export function sortRows<T, K extends string>(
  rows: T[],
  sort: { by?: K; dir?: SortDir } | undefined,
  /** Column id → the value that column sorts on. Every sortable id needs an entry. */
  keys: Record<K, (row: T) => SortValue>,
): T[] {
  const accessor = sort?.by ? keys[sort.by] : undefined
  if (!accessor) return rows
  // Descending is the default for the same reason it is in `listApplications`: an
  // unqualified sort on a listing screen means "most, newest, biggest first".
  const sign = sort?.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = comparable(accessor(a))
    const y = comparable(accessor(b))
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    if (typeof x === 'string' || typeof y === 'string') {
      return sign * String(x).localeCompare(String(y), 'en-GB', { sensitivity: 'base' })
    }
    return sign * (Number(x) - Number(y))
  })
}
