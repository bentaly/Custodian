// ─── Place lookup — Google Geocoding ─────────────────────────────────────────
//
// Turns a foundation's free-text delivery area into a place. It replaced the
// postcodes.io `/places` gazetteer (OS Open Names) and a Nominatim fallback,
// which between them could not do this job: OS Open Names is a flat list of
// settlement names with no notion of prominence, context or venues, so "Preston"
// led with a 1.5km suburban area in Scotland ahead of the Lancashire city and
// "Broadhurst Park, Manchester" matched nothing at all. Ranking the homonyms
// raised the floor but could not fix either class — it still preferred the big
// place when someone meant the small one, and a gazetteer containing no venues
// cannot find a stadium however it is sorted.
//
// What this does NOT do is replace postcodes.io. Google never returns GSS codes
// (E01…/S01…), and GSS codes are the only thing `deprivation_areas` joins on. So
// Google identifies the place and hands back a coordinate, `reverseGeocode`
// turns that coordinate into ward/LAD/region codes, and our own table turns those
// into deciles. Three layers, one job each — see the header on `run.ts`.
//
// Nothing here is persisted. The coordinate is a value in flight, handed straight
// to `reverseGeocode`, which sidesteps Google's restriction on storing geocoding
// results rather than needing an answer to it. The Insights map is a boundary
// choropleth keyed on `delivery_region` / `delivery_lad_code`, so it never wanted
// a coordinate in the first place.

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json'

/** A degree of latitude is ~111km everywhere; longitude shrinks by cos(lat). */
const KM_PER_DEGREE = 111

export interface GeocodedPlace {
  name: string
  longitude: number
  latitude: number
  /** Bounding-box extent (the larger of width/height) in km — the signal `run.ts`
   *  uses to choose ward / LAD / region (town ≈ 4km, city ≈ 20km, London ≈ 54km). */
  extentKm: number
  /** What kind of thing Google matched: `postal_town`, `locality`,
   *  `administrative_area_level_2`, `establishment`, `premise`, `street_address`… */
  types: string[]
  /** Google matched only part of the query — a real uncertainty signal. */
  partialMatch: boolean
  /** ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE. */
  locationType: string | null
}

/**
 * Three outcomes, not two, because "Google says there is no such place" and
 * "we could not ask Google" are different facts and the application shows them
 * differently.
 *
 * `no_match` is a VERDICT on what the applicant wrote — it becomes `unresolvable`,
 * which a grants officer reads on the application as "this text is not a place,
 * go and fix it". `unavailable` is a fact about US — a missing key, a refused key,
 * the daily quota stop, a network failure — and becomes `pending`, which says
 * "not run yet" and is what `rerun-deprivation.ts --pending` comes back for.
 *
 * Collapsing the two mattered less when there were three providers and a total
 * failure was implausible. With one provider a misconfigured key would otherwise
 * stamp a whole foundation's portfolio `unresolvable` — indistinguishable, on
 * screen, from every delivery area being nonsense.
 */
export type GeocodeOutcome =
  | { kind: 'match'; place: GeocodedPlace }
  | { kind: 'no_match' }
  | { kind: 'unavailable'; reason: string }

type LatLng = { lat: number; lng: number }
type Box = { northeast: LatLng; southwest: LatLng }

function extentKmOf(box: unknown): number {
  const b = box as Box | undefined
  const ne = b?.northeast
  const sw = b?.southwest
  if (!ne || !sw) return 0
  if (![ne.lat, ne.lng, sw.lat, sw.lng].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return 0
  }
  const latKm = Math.abs(ne.lat - sw.lat) * KM_PER_DEGREE
  const midLat = ((ne.lat + sw.lat) / 2) * (Math.PI / 180)
  const lngKm = Math.abs(ne.lng - sw.lng) * KM_PER_DEGREE * Math.cos(midLat)
  return Math.max(latKm, lngKm)
}

/**
 * Is this result a COUNTY rather than a settlement?
 *
 * "Merseyside" is five local authorities (Liverpool, Sefton, Knowsley, St Helens,
 * Wirral) and its bounding box is around 35km — comfortably under `LAD_EXTENT_KM`.
 * On the extent rule alone it would resolve as a LAD, and the centroid would pick
 * ONE of the five and silently drop the other four. Reporting the region's spread
 * instead is vague, but it is not a confident lie.
 *
 * A holding position until `deprivation_areas` carries a county column, which is
 * what turns "North West" into "Merseyside, deciles 1–8, typically 3".
 *
 * `administrative_area_level_2` on its own is not the test: Google also applies it
 * to some cities. A result that is ALSO a town or city is the settlement it says
 * it is, and is scored normally.
 */
export function looksLikeCounty(types: string[] | undefined): boolean {
  if (!types?.includes('administrative_area_level_2')) return false
  return !types.some((t) => t === 'postal_town' || t === 'locality')
}

/**
 * Normalise a settlement name for comparison against the ONS local-authority
 * register, which spells things its own way: "Bristol, City of", "Kingston upon
 * Hull, City of", "St. Helens". Google says "Bristol", "Kingston upon Hull",
 * "St Helens". Codes would be exact, but Google never returns one, so this is the
 * join — and it has to survive the register's qualifiers.
 */
function normaliseSettlement(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return base
    .replace(/^city of /, '')
    .replace(/ city of$/, '')
    .trim()
}

/** Do these two name the same area? The join between what Google matched and what
 *  postcodes.io reported — used for the district ("Preston" IS Preston) and for the
 *  police force area ("Merseyside" IS Merseyside). Exact, after normalisation: it
 *  never guesses, so a mismatch simply widens to the next geography out. */
export function sameAreaName(placeName: string, areaName: string | null): boolean {
  if (!areaName) return false
  return normaliseSettlement(placeName) === normaliseSettlement(areaName)
}

/**
 * Which official geography to report a place at.
 *
 * This used to be decided by bounding-box size alone, because the gazetteer gave
 * us nothing else to go on. Google says what it matched, so the CLASS of thing is
 * now a fact rather than an inference from its footprint.
 *
 *   venue / address   → ward    a stadium or a street sits IN a neighbourhood, and
 *                               the ward containing it is the delivery area. Its
 *                               own footprint (~0.3km) is meaningless.
 *   neighbourhood     → ward    already ward-sized by definition.
 *   county            → pfa     see `looksLikeCounty` — five LADs, not one, so it is
 *                                answered by police force area (the only maintained
 *                                stand-in for a ceremonial county) when the names
 *                                agree, and by the region when they do not.
 *   region / nation   → region  "North West", "Scotland".
 *   country           → too_broad
 *   bigger than a LAD → pfa     "Cumbria" (128km) arrives as a `colloquial_area`, not
 *                                a county, so only its footprint catches it. "London"
 *                                takes the same route and finds no matching PFA
 *                                ("Metropolitan Police"), so it lands on its region.
 *   town / city       → does the NAME match the region, or the district, it sits in?
 *
 * That last rule replaced a size threshold, which was wrong in both directions and
 * on real Arete data: "Stockport" (8.8km) reported the centroid's ward — Brinnington
 * & Stockport Central, decile 1–3, typically 1 — for a borough that is not remotely
 * that deprived, while "Birkenhead" (16.3km) tipped over the threshold and reported
 * the whole of Wirral, typically 5, for a town that is deprived. The boundary was
 * arbitrary: Birkenhead and Preston are the same kind of place and fell on opposite
 * sides of it. And because the ward is always the CENTROID's ward, a town always
 * reported its town centre — systematically its most deprived part.
 *
 * The name comparison is exact where the threshold was a guess. "Preston" IS the
 * district of Preston, so the applicant means all of it. "Birkenhead" is a town in
 * Wirral, so they mean Birkenhead, and the centroid's ward is the right read.
 */
export type ReportingLevel = 'ward' | 'lad' | 'pfa' | 'region' | 'too_broad'

const VENUE_TYPES = [
  'establishment',
  'point_of_interest',
  'premise',
  'subpremise',
  'street_address',
  'route',
  'intersection',
  'park',
]

const NEIGHBOURHOOD_TYPES = [
  'neighborhood',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
]

export function reportingLevel(
  place: Pick<GeocodedPlace, 'types' | 'extentKm' | 'name'>,
  area: { region: string | null; ladName: string | null },
  ladExtentKm: number,
): ReportingLevel {
  const has = (list: string[]) => place.types.some((t) => list.includes(t))

  // A venue is checked before anything else: "Broadhurst Park, Manchester" carries
  // `establishment` AND the city in its address components, and it is the venue
  // that says where the work happens.
  if (has(VENUE_TYPES) || has(NEIGHBOURHOOD_TYPES)) return 'ward'
  if (place.types.includes('country')) return 'too_broad'
  if (looksLikeCounty(place.types)) return 'pfa'
  if (place.types.includes('administrative_area_level_1')) return 'region'

  // Still a size question, and the only one left: anything wider than a district
  // cannot be reported as one. "Cumbria" arrives as a `colloquial_area` rather than
  // a county, and only its 128km footprint says it is too big to be Westmorland.
  if (place.extentKm > ladExtentKm) return 'pfa'

  // The region is checked BEFORE the district, and "London" is why. Its Google
  // footprint is 34.5km — UNDER the threshold above — and no district is called
  // London (the centroid lands in Westminster), so on the district test alone it fell
  // through to ward and reported St James's: six neighbourhoods, for a city of nine
  // million. It does name a region, though, which is the honest answer and the one
  // this module always intended for it.
  //
  // Order also settles a real collision: ONS calls the Square Mile "City of London",
  // which normalises to "london" and would otherwise match the district instead.
  if (sameAreaName(place.name, area.region)) return 'region'
  return sameAreaName(place.name, area.ladName) ? 'lad' : 'ward'
}

/**
 * One Google result → our shape. Pure, so the fixtures in the test file are the
 * real payloads and no network is involved.
 *
 * `bounds` is the place's actual footprint and is what we want; `viewport` is a
 * display hint Google always supplies, and is padded — it is the fallback only,
 * because for a small place the viewport is several times the real extent and
 * would push a ward-sized answer up to LAD.
 *
 * The name comes from the first address component rather than `formatted_address`,
 * which is a postal string ("310 Lightbowne Rd, Manchester M40 0FJ, UK") carrying
 * a street and a country. The first component is the entity that matched:
 * "Preston", or "Broadhurst Park" for the venue.
 */
export function parseGeocodeResult(query: string, result: unknown): GeocodedPlace | null {
  const r = result as any
  const loc = r?.geometry?.location
  const latitude = Number(loc?.lat)
  const longitude = Number(loc?.lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const component = r?.address_components?.[0]?.long_name
  const name =
    (typeof component === 'string' && component.trim()) ||
    String(r?.formatted_address ?? '')
      .split(',')[0]
      ?.trim() ||
    query.trim()

  return {
    name,
    longitude,
    latitude,
    extentKm: extentKmOf(r?.geometry?.bounds) || extentKmOf(r?.geometry?.viewport),
    types: Array.isArray(r?.types) ? r.types.filter((t: unknown) => typeof t === 'string') : [],
    partialMatch: r?.partial_match === true,
    locationType: typeof r?.geometry?.location_type === 'string' ? r.geometry.location_type : null,
  }
}

/**
 * Geocode a free-text place name. Never throws — deprivation must never block an
 * application from being created — but it does distinguish the three outcomes
 * above rather than flattening everything to null.
 *
 * `components=country:GB` RESTRICTS (not merely biases) results to the United
 * Kingdom, which is the whole domain here: it stops "Preston" reaching Idaho, and
 * — because ISO 3166-1 `GB` is the United Kingdom, not Great Britain — it covers
 * Northern Ireland, the one gap the deleted Nominatim fallback was carried for.
 */
export async function geocodePlace(query: string): Promise<GeocodeOutcome> {
  const key = process.env['GOOGLE_MAPS_API_KEY']
  if (!key) return { kind: 'unavailable', reason: 'GOOGLE_MAPS_API_KEY not set' }
  const trimmed = query.trim()
  if (!trimmed) return { kind: 'no_match' }

  try {
    const url =
      `${ENDPOINT}?address=${encodeURIComponent(trimmed)}` +
      `&components=country:GB&key=${encodeURIComponent(key)}`
    const res = await fetch(url)
    if (!res.ok) return { kind: 'unavailable', reason: `HTTP ${res.status}` }
    const body = (await res.json()) as { status?: string; results?: unknown[] }

    // ZERO_RESULTS is Google answering the question. REQUEST_DENIED (bad or
    // unrestricted key), OVER_QUERY_LIMIT (the daily cap) and UNKNOWN_ERROR are
    // all facts about us, and must not be written onto the application as a
    // verdict about the applicant's text.
    if (body.status === 'ZERO_RESULTS') return { kind: 'no_match' }
    if (body.status !== 'OK') {
      return { kind: 'unavailable', reason: `status ${body.status ?? 'missing'}` }
    }

    const first = Array.isArray(body.results) ? body.results[0] : null
    if (!first) return { kind: 'no_match' }
    const place = parseGeocodeResult(trimmed, first)
    // OK with a result we cannot read is malformed, not "no such place".
    return place ? { kind: 'match', place } : { kind: 'unavailable', reason: 'unreadable result' }
  } catch (e) {
    return { kind: 'unavailable', reason: e instanceof Error ? e.message : 'fetch failed' }
  }
}
