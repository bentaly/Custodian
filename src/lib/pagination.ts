/**
 * The listing-table convention: every table in the app is paged, at the same size, with
 * the same page/total contract.
 *
 * The reason is not tidiness. A grants list is unbounded — a foundation five years in
 * has thousands of awards and reports — and an unpaged table pays for that on every
 * load, in the query, on the wire, and in the DOM, long before anyone notices it is
 * slow. Paging is also the only honest answer to "how many are there?", because `total`
 * is a count of the whole filtered set rather than of whatever happened to render.
 *
 * Three ways to satisfy the contract, depending on where the rows come from:
 *
 * - **In the database** (`listApplications`) — `offset`/`limit` with a separate
 *   `count()`. Always preferable: the rows never leave Postgres.
 * - **In memory, on the server** (`paginate`, below) — for lists whose rows are
 *   *derived* rather than selected: a report row is an award's schedule crossed with
 *   what has been received, a finance row is instalments rolled up. Those cannot be
 *   offset in SQL without materialising the derivation first, so they are built, then
 *   sliced.
 * - **In memory, on the client** — for bounded config lists (team members, API keys),
 *   which are already loaded whole and small by nature. They still show the same
 *   Pagination line so no table is a special case.
 *
 * Either way the screen sees the same `{ items, total, page, pageSize }`, and totals or
 * facets shown beside the table are computed from the **whole filtered set**, never
 * from the page — a KPI that changes when you turn the page is a bug.
 *
 * Where the page number lives is a separate question, answered by whether the table is
 * a destination. On the data screens it is a URL search param, so a paged view can be
 * linked and survives opening a row and coming back; on the settings tables it is local
 * state, because nobody links to page 2 of their own team.
 */

/** Rows per page, everywhere. One number so no two tables disagree. */
export const PAGE_SIZE = 25

export type Paged<T> = {
  items: T[]
  /** Rows in the whole filtered set, not on this page. */
  total: number
  page: number
  pageSize: number
}

/** Clamp a page number from user input (a hand-edited URL) onto the available pages. */
export function clampPage(page: number | undefined, total: number, pageSize = PAGE_SIZE): number {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (!page || !Number.isInteger(page) || page < 1) return 1
  return Math.min(page, pageCount)
}

/**
 * Slice derived rows into a page. Takes the *whole* filtered set, so callers compute
 * their totals before calling this, not after.
 */
export function paginate<T>(rows: T[], page?: number, pageSize = PAGE_SIZE): Paged<T> {
  const total = rows.length
  const current = clampPage(page, total, pageSize)
  const start = (current - 1) * pageSize
  return { items: rows.slice(start, start + pageSize), total, page: current, pageSize }
}
