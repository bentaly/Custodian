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

export type DeprivationNation = 'england' | 'scotland' | 'wales' | 'northern_ireland'

// The geography we snapped the location onto. A postcode pins to a single LSOA; a
// town to its ward; a city to its local authority district; a county (e.g.
// "Merseyside") to its police force area, which is the closest maintained stand-in
// for a ceremonial county; a large place (e.g. "London") to its statistical region —
// each progressively wider, all shown as a range.
export type DeprivationAreaType = 'lsoa' | 'ward' | 'lad' | 'pfa' | 'region'

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
  return {
    nation: result.nation,
    region: result.regionName,
    ladCode: result.ladCode,
    ladName: result.ladName,
  }
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

// Bounding-box extent (larger of width/height, km) above which a place is too wide
// to be reported as a single district, so its statistical region is used instead —
// e.g. London ≈ 54km, Cumbria ≈ 128km. If such a place has no region (non-England,
// or unmatched) it is reported as too_broad rather than guessed at.
//
// This is the ONLY size threshold left. Ward-vs-LAD used to be a second one
// (WARD_EXTENT_KM = 15), and it was wrong in both directions on real data — see
// `reportingLevel` in src/server/deprivation/googleGeocode.ts, which decides that
// by asking whether the place names the whole district or somewhere inside it.
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
  return stats.min === stats.max ? `Decile ${stats.min}` : `Decile ${stats.min}–${stats.max}`
}

/**
 * The location to PRINT on a row, a card or a header.
 *
 * Every screen used to show `deliveryRegion ?? deliveryArea`, which for a foundation
 * funding one part of the country makes every applicant read "North West" — the one
 * fact they already knew. The resolver has always stored something sharper: Preston's
 * district, Birkenhead's ward's district, Merseyside's police force area. So prefer
 * the district, then the matched area's own name (which is what carries a county-level
 * match, where a district would be meaningless), then the region, then the applicant's
 * own words for a location that never resolved.
 */
export function deliveryAreaLabel(app: {
  deliveryLadName?: string | null
  deprivationContext?: DeprivationResult | null
  deliveryRegion?: string | null
  deliveryArea?: string | null
}): string | null {
  const context = app.deprivationContext
  const areaName = context?.status === 'resolved' ? context.areaName : null
  return app.deliveryLadName ?? areaName ?? app.deliveryRegion ?? app.deliveryArea ?? null
}

// Scotland and NI have no sub-national region in our data (their indices are national
// and `regionName` is deliberately null there), so they are grouped under the nation.
// England's regions and "Wales" already name themselves.
const NATION_LABELS: Partial<Record<DeprivationNation, string>> = {
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
}

/**
 * The filter value meaning "no location recorded" — a grant whose delivery area never
 * resolved. A sentinel rather than an empty string because it travels in a URL, where
 * absent and "explicitly the unlocated ones" are different requests. Shared so a link
 * from Insights to the Awards register carries a value the register recognises.
 */
export const NO_REGION = 'none'

/**
 * The location to GROUP a portfolio by — the coarse twin of `deliveryAreaLabel`.
 *
 * England's nine regions, "Wales", and the nation for Scotland/NI: a bounded dozen
 * values, which is what makes it a filter you can offer as pills. `deliveryAreaLabel`
 * is the opposite and deliberately so — it resolves to a district, and a district is
 * very nearly a primary key (ten grants, ten districts), so faceting on it would put
 * one pill on screen per grant and, for anything unresolved, the applicant's own
 * free text alongside them.
 *
 * Insights and the Awards register both group on this, and the strings must be
 * IDENTICAL or a link from one to the other silently lands on an empty list. That is
 * the whole reason this is a function rather than a coalesce written twice — the SQL
 * in `server/awards/query.ts` mirrors it and says so.
 */
export function deliveryRegionLabel(app: {
  deliveryRegion?: string | null
  deliveryNation?: DeprivationNation | null
}): string | null {
  return (
    app.deliveryRegion ?? (app.deliveryNation ? (NATION_LABELS[app.deliveryNation] ?? null) : null)
  )
}

// ─── A region named outright ───────────────────────────────────────────────────
//
// "North West" is a delivery area a foundation really does write, and it is the one
// input the geocoder cannot be trusted with: Google restricts to GB and answers with
// "Northwest", an `administrative_area_level_3` inside Kilmarnock, so a North West
// England portfolio reported East Ayrshire, Scotland. That is not a near miss to be
// widened later — the whole chain downstream is reasoning about the wrong country.
//
// So a region is matched on its NAME, before anything is geocoded. `deprivation_areas
// .region_name` carries exactly ten values (England's nine plus Wales), and the match
// is exact after normalisation, in the same spirit as the police-force rule: never a
// wrong answer, sometimes no better one. Only spellings that can mean nothing else are
// accepted — "Yorkshire" alone is not one of them, since it is as likely to mean one of
// the three Yorkshire police areas as the statistical region, and Google reads it
// correctly anyway.
//
// Scotland and Northern Ireland are deliberately absent: neither has a statistical
// region below the nation, so naming one is `too_broad`, which is what it already
// resolves to.
//
// **"West Midlands" names two geographies and is included anyway.** It is a region of
// 3,574 neighbourhoods and also a police force area of 1,702 (the metropolitan county).
// Being in this list does not decide that: `reportingLevel` tests the region name
// before the county rule, so the geocoded path already answers West Midlands with the
// region. The list changes what it costs, not what it says.
const REGION_NAMES = [
  'East Midlands',
  'East of England',
  'London',
  'North East',
  'North West',
  'South East',
  'South West',
  'West Midlands',
  'Yorkshire and The Humber',
  'Wales',
] as const

/** Aliases that can only mean one region. Keyed by their normalised form. */
const REGION_ALIASES: Record<string, (typeof REGION_NAMES)[number]> = {
  'north west england': 'North West',
  'north east england': 'North East',
  'south west england': 'South West',
  'south east england': 'South East',
  'east of england region': 'East of England',
  'eastern england': 'East of England',
  'east midlands region': 'East Midlands',
  'west midlands region': 'West Midlands',
  'yorkshire and humber': 'Yorkshire and The Humber',
  'yorkshire the humber': 'Yorkshire and The Humber',
  'yorkshire humber': 'Yorkshire and The Humber',
  'greater london': 'London',
  'cymru': 'Wales',
}

/** Normalised for comparison: case, punctuation and "&" folded away. */
function normaliseRegion(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z]+/g, ' ')
    .replace(/^the /, '')
    .trim()
}

/**
 * Does this free text name one of the statistical regions outright? Returns the
 * region's name exactly as `deprivation_areas.region_name` spells it, or null.
 */
export function matchRegionName(input: string): string | null {
  const key = normaliseRegion(input)
  if (!key) return null
  const exact = REGION_NAMES.find((r) => normaliseRegion(r) === key)
  if (exact) return exact
  return REGION_ALIASES[key] ?? null
}
