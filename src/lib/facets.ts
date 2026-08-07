/**
 * Filter options derived from the rows themselves, rather than from a list of
 * everything that could theoretically exist.
 *
 * The rule this encodes: **a filter must only offer values that are actually in the
 * data you are looking at.** A Programme dropdown listing every programme the
 * foundation has ever run, while you are inside one round, is worse than useless — most
 * of its options return nothing, and the ones that do are buried. Options carry counts
 * for the same reason: "Youth work (24)" tells you whether the filter is worth using
 * before you use it.
 *
 * Facets are computed from the rows in the current *context* (the round you are in, the
 * tenant you belong to) but **before** the transient filters — status, theme, search,
 * dates — are applied. That is deliberate: if narrowing by one filter pruned the others'
 * options, you could filter yourself into a corner with no way back out except clearing
 * everything.
 */
export type FacetOption = { value: string; label: string; count: number }

/**
 * Count rows by a key. `key` returns the facet a row belongs to, or `null` when the row
 * has none (an application with no programme, say) — those rows are simply not counted,
 * never bucketed under an invented "Unknown".
 */
export function facetBy<T>(
  rows: T[],
  key: (row: T) => { value: string; label: string } | null,
): FacetOption[] {
  const seen = new Map<string, FacetOption>()
  for (const row of rows) {
    const k = key(row)
    if (!k) continue
    const existing = seen.get(k.value)
    if (existing) existing.count += 1
    else seen.set(k.value, { value: k.value, label: k.label, count: 1 })
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** As `facetBy`, for a row that belongs to several facets at once (themes/tags). */
export function facetByMany<T>(
  rows: T[],
  keys: (row: T) => Array<{ value: string; label: string }>,
): FacetOption[] {
  const seen = new Map<string, FacetOption>()
  for (const row of rows) {
    for (const k of keys(row)) {
      const existing = seen.get(k.value)
      if (existing) existing.count += 1
      else seen.set(k.value, { value: k.value, label: k.label, count: 1 })
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** `Youth work (24)` — the label a filter pill shows. */
export function facetLabel(option: FacetOption): string {
  return `${option.label} (${option.count})`
}
