// ─── Deprivation context — shared types & pure helpers ──────────────────────────
//
// "Deprivation context" turns an application's free-text location (e.g. a postcode,
// "Potters Bar", or "London") into an Index of Multiple Deprivation reading.
//
// The index is published per-nation and is NOT comparable across nations — England
// (IoD2025), Wales (WIMD2025), Scotland (SIMD2020) and Northern Ireland (NIMDM2017)
// each rank their own small areas on their own scale. So a result is always labelled
// with its nation + vintage, and we never compare a decile across the border.
//
// Decile 1 = the MOST deprived 10% of areas in that nation; decile 10 = the least.
//
// This module is pure (no DB, no network) so it can be unit-tested and imported from
// both the server runner and the schema. The network/DB orchestration lives in
// src/server/deprivation/.

export type DeprivationStatus =
  // Not yet resolved (no geography on the application, or resolution not run).
  | 'pending'
  // Mapped to one or more small areas; a decile range is available.
  | 'resolved'
  // Matched a real place, but one too large to mean anything (e.g. "London",
  // "Yorkshire") — a single decile would be misleading, so we decline.
  | 'too_broad'
  // Could not be matched to any place at all (typo, nonsense, or unsupported area).
  | 'unresolvable'

export type DeprivationNation =
  | 'england'
  | 'scotland'
  | 'wales'
  | 'northern_ireland'

// The geography we snapped the location onto. A postcode pins to a single LSOA; a
// town to its ward; a city to its local authority district; a large place (e.g.
// "London") to its statistical region — each progressively wider, all shown as a range.
export type DeprivationAreaType = 'lsoa' | 'ward' | 'lad' | 'region'

// Distribution of deciles across the small areas the location resolved to. For a
// postcode this collapses to a single area (min === max === median, count 1).
export interface DecileStats {
  count: number
  min: number // most deprived decile present (1 = most deprived)
  max: number // least deprived decile present
  median: number
  // Counts per decile, index 0 → decile 1 … index 9 → decile 10. Lets the portfolio
  // derive shares (e.g. "% in deciles 1–2") without re-querying.
  histogram: number[]
}

export interface DeprivationContext extends DecileStats {
  nation: DeprivationNation
  vintage: string // e.g. 'IoD2025'
  areaType: DeprivationAreaType
  areaName: string // e.g. 'Potters Bar Parkfield' (ward) or 'Leeds' (LAD)
  resolvedVia: 'postcode' | 'place'
  // Administrative location of the matched area, for portfolio breakdowns. `regionName`
  // is England's region (or "Wales"); null for Scotland/NI. `lad*` is the local
  // authority; null for region-level matches (which span many LADs).
  regionName: string | null
  ladCode: string | null
  ladName: string | null
}

// Flat administrative-geography fields persisted on the application for "funding by
// region / district" insights. Populated whenever the location resolves.
export interface DeliveryGeo {
  nation: DeprivationNation | null
  region: string | null
  ladCode: string | null
  ladName: string | null
}

export function deliveryGeoFromResult(result: DeprivationResult): DeliveryGeo {
  if (result.status !== 'resolved') {
    return { nation: null, region: null, ladCode: null, ladName: null }
  }
  return { nation: result.nation, region: result.regionName, ladCode: result.ladCode, ladName: result.ladName }
}

// What we persist on the application. The discriminated union mirrors DeprivationStatus
// so the (denormalised) status column and this payload never disagree. `input` is kept
// on every variant so the UI can say e.g. "unresolvable for: 'Pottres Bar'".
export type DeprivationResult =
  | { status: 'pending' }
  | ({ status: 'resolved'; input: string } & DeprivationContext)
  | { status: 'too_broad'; input: string; matchedName: string; extentKm: number }
  | { status: 'unresolvable'; input: string }

// Latest available index per nation. Update when a nation republishes (England/Wales
// 2025; Scotland's next lands ~late 2026; NI's NIMDM2017 is the current measure).
export const NATION_VINTAGE: Record<DeprivationNation, string> = {
  england: 'IoD2025',
  wales: 'WIMD2025',
  scotland: 'SIMD2020',
  northern_ireland: 'NIMDM2017',
}

// Bounding-box extent (larger of width/height, km) decides how wide a unit we snap a
// place onto — the centroid's ward/LAD stops being representative as a place grows:
//   ≤ WARD_EXTENT_KM            → ward   (a town, e.g. Potters Bar ≈ 4km)
//   ≤ LAD_EXTENT_KM            → LAD    (a city, e.g. Leeds ≈ 17km, Birmingham ≈ 22km)
//   >  LAD_EXTENT_KM           → region (e.g. London ≈ 54km → its statistical region)
// If a place is region-sized but has no region (non-England, or unmatched) it is
// reported as too_broad rather than guessing.
export const WARD_EXTENT_KM = 15
export const LAD_EXTENT_KM = 40

// First letter of a GSS statistical-geography code identifies the nation:
// E = England, W = Wales, S = Scotland, N = Northern Ireland. NI is keyed on its
// legacy SOA codes (e.g. "95AA01S1") which start with a digit — map those to NI too,
// matching what NIMDM2017 and postcodes.io's `lsoa11` field use.
export function nationFromGssCode(code: string): DeprivationNation | null {
  const first = code.charAt(0).toUpperCase()
  if (first >= '0' && first <= '9') return 'northern_ireland'
  switch (first) {
    case 'E':
      return 'england'
    case 'W':
      return 'wales'
    case 'S':
      return 'scotland'
    case 'N':
      return 'northern_ireland'
    default:
      return null
  }
}

// Full UK postcode (with or without the internal space). Deliberately strict on shape
// but not on real existence — postcodes.io is the source of truth for that. Partial
// "outcodes" (e.g. "EN6") are intentionally NOT matched here: they cover many LSOAs,
// so they fall through to the place-name path.
const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i

export function looksLikePostcode(input: string): boolean {
  return POSTCODE_RE.test(input.trim())
}

// Build a decile distribution from a flat list of area deciles.
export function decileStats(deciles: number[]): DecileStats {
  const sorted = [...deciles].sort((a, b) => a - b)
  const histogram = Array<number>(10).fill(0)
  for (const d of deciles) {
    if (d >= 1 && d <= 10) histogram[d - 1] = (histogram[d - 1] ?? 0) + 1
  }
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    // Lower median — a real decile value, appropriate for an ordinal scale.
    median: sorted[Math.floor((sorted.length - 1) / 2)]!,
    histogram,
  }
}

// Headline for the UI, e.g. "Decile 3" (single area) or "Decile 2–6".
export function formatDecileRange(stats: Pick<DecileStats, 'min' | 'max'>): string {
  return stats.min === stats.max
    ? `Decile ${stats.min}`
    : `Decile ${stats.min}–${stats.max}`
}
