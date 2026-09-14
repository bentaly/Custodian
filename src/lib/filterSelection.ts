// ─── Multi-select filters: what a tick means ─────────────────────────────────────
//
// Every filter pill takes several values. The rules for what a selection means live here,
// once, so the pill, the URL parsers and the two screens that filter in the browser
// (Insights, Set up awards) cannot drift apart on them. The SQL twin is
// `server/filterSql.ts`.
//
// 1. **Within one pill values are OR'd, across pills AND.** "Youth work or Housing, and
//    active" — never "tagged with both themes", which is a question nobody asks of a
//    filter and which empties the list the moment a second theme is ticked.
//
// 2. **Ticking every option is the same as ticking none, and is STORED as none.** Stored,
//    not merely read that way, because the options are facets of the rows in context and
//    "every option" moves: all three programmes in one round is three of five in the
//    next, and a saved link holding all three would quietly start hiding the programme
//    added after it. Collapsing on the tick keeps "everything" meaning everything, and it
//    keeps rows with NO value (a grant with no programme, which no facet counts) in view,
//    as the unfiltered list has them.
//
//    The exception is a pill with ONE option. Collapsing there would untick the box in
//    the instant it was ticked, which reads as the click not landing.

/**
 * The selection after `value` is ticked or unticked. `undefined` is the filter off — the
 * only spelling of it, so an empty list never reaches a URL.
 */
export function toggleFilterValue(
  current: readonly string[] | undefined,
  value: string,
  optionValues: readonly string[],
): string[] | undefined {
  const next = current?.includes(value)
    ? current.filter((v) => v !== value)
    : [...(current ?? []), value]
  if (next.length === 0) return undefined
  if (optionValues.length > 1 && optionValues.every((v) => next.includes(v))) return undefined
  return next
}

/** Does a row's single value pass the filter? No selection passes everything. */
export function matchesFilter(
  selected: readonly string[] | undefined,
  value: string | null | undefined,
): boolean {
  if (!selected?.length) return true
  return value != null && selected.includes(value)
}

/** As `matchesFilter`, for a row holding several values (themes): any one of them. */
export function matchesAnyFilter(
  selected: readonly string[] | undefined,
  values: readonly string[],
): boolean {
  if (!selected?.length) return true
  return values.some((v) => selected.includes(v))
}

/**
 * A selection as one line of prose — "Youth work, Housing +2 more" — for places that
 * print the filters rather than draw them (the Insights PDF). `all` when nothing is
 * selected.
 */
export function summariseSelection(labels: readonly string[], all: string, max = 3): string {
  if (labels.length === 0) return all
  const shown = labels.slice(0, max).join(', ')
  return labels.length > max ? `${shown} +${labels.length - max} more` : shown
}
