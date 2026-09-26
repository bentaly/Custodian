import { NO_LOCATION, type DeliveryPlaceKind } from './deprivation/types'

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


/** A Location option: a facet plus the kind of place it names, drawn beneath it. */
export type LocationFacetOption = FacetOption & {
  kind: Exclude<DeliveryPlaceKind, 'region'> | null
}

/**
 * The Awards register's Location pill, from rows grouped on (location, kind).
 *
 * - A region-level match (`kind: 'region'`) is dropped: its label is a region name, and
 *   the Region pill beside this one already offers it.
 * - The NULL group becomes `NO_LOCATION`, pinned LAST, as "No location recorded" is on
 *   the Region pill — it is not a place, it is the residue.
 * - One name can arrive under two kinds (free text that happens to spell a district
 *   whose own grants resolved). The filter matches on the name, so it is ONE option,
 *   counted once for every grant it returns, and wears the kind most of them have.
 */
export function locationFacet(
  rows: Array<{ value: string | null; kind: string | null; count: number }>,
): LocationFacetOption[] {
  const byName = new Map<string, { count: number; kinds: Map<string, number> }>()
  let unlocated = 0
  for (const r of rows) {
    if (r.kind === 'region') continue
    if (r.value === null || r.kind === null) {
      if (r.kind === null) unlocated += r.count
      continue
    }
    const entry = byName.get(r.value) ?? { count: 0, kinds: new Map<string, number>() }
    entry.count += r.count
    entry.kinds.set(r.kind, (entry.kinds.get(r.kind) ?? 0) + r.count)
    byName.set(r.value, entry)
  }
  const named = [...byName.entries()]
    .map(([value, { count, kinds }]) => ({
      value,
      label: value,
      count,
      kind: [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]![0] as LocationFacetOption['kind'],
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return unlocated > 0
    ? [
        ...named,
        { value: NO_LOCATION, label: 'No location recorded', count: unlocated, kind: null },
      ]
    : named
}
