// ─── postcodes.io client ─────────────────────────────────────────────────────
//
// Thin wrapper over the free, key-less postcodes.io API. It does three jobs for
// deprivation resolution:
//   1. forward postcode lookup  → the postcode's LSOA/Data Zone/SOA code
//   2. place-name geocode       → a coordinate + bounding box (OS Open Names data)
//   3. reverse geocode          → the ward/LSOA/LAD for a coordinate
//
// Every function returns null on any failure (network, 404, malformed) and NEVER
// throws — deprivation resolution must never block an application from being created,
// exactly like due diligence and scoring.

const BASE = 'https://api.postcodes.io'

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = (await res.json()) as { status?: number; result?: unknown }
    if (body.status !== 200 || body.result == null) return null
    return body.result
  } catch {
    return null
  }
}

export interface PostcodeArea {
  // GSS code of the small area the postcode sits in (E01…/W01…/S01…/N…).
  lsoaCode: string | null
  lsoaName: string | null
  wardCode: string | null
  wardName: string | null
  ladCode: string | null
  ladName: string | null
  // Statistical region NAME (England only, e.g. "London"); null for the other nations.
  region: string | null
  country: string | null
}

function toArea(r: any): PostcodeArea {
  const codes = r?.codes ?? {}
  // Our reference table is keyed on the small-area vintage each nation's index uses:
  //   England / Wales  → 2021 LSOA  → postcodes.io `lsoa` (a.k.a. lsoa21)
  //   Scotland (SIMD2020, 2011 data zones) and NI (NIMDM2017, 2001 SOAs) predate that,
  //   so use `lsoa11` — the newer `lsoa` returns codes (2022 DZ / N21 SOA) that don't join.
  const country = r?.country
  const useLegacyCode = country === 'Scotland' || country === 'Northern Ireland'
  return {
    lsoaCode: (useLegacyCode ? codes.lsoa11 : codes.lsoa) ?? null,
    lsoaName: r?.lsoa ?? null,
    wardCode: codes.admin_ward ?? null,
    wardName: r?.admin_ward ?? null,
    ladCode: codes.admin_district ?? null,
    ladName: r?.admin_district ?? null,
    region: r?.region ?? null,
    country: r?.country ?? null,
  }
}

/** Forward lookup of a full postcode → its small-area codes, or null if invalid. */
export async function lookupPostcode(postcode: string): Promise<PostcodeArea | null> {
  const r = await getJson(`${BASE}/postcodes/${encodeURIComponent(postcode.trim())}`)
  return r ? toArea(r) : null
}

/** Reverse geocode a coordinate → the nearest postcode's small-area codes.
 *  `wideSearch=true` extends the search to ~20km so a rural place's centroid (e.g.
 *  Calderdale moorland, North Yorkshire) still finds a postcode and resolves. */
export async function reverseGeocode(
  longitude: number,
  latitude: number,
): Promise<PostcodeArea | null> {
  const r = await getJson(
    `${BASE}/postcodes?lon=${longitude}&lat=${latitude}&limit=1&wideSearch=true`,
  )
  const first = Array.isArray(r) ? r[0] : null
  return first ? toArea(first) : null
}

export interface GeocodedPlace {
  name: string
  longitude: number
  latitude: number
  // Bounding box extent (the larger of width/height) in kilometres — our signal for
  // how broad the place is (town ≈ 4km, city ≈ 20km, London ≈ 54km).
  extentKm: number
}

/** Geocode a free-text place name. Tries postcodes.io /places first (OS Open Names —
 *  fast, key-less, but GREAT BRITAIN ONLY), then falls back to Nominatim (OpenStreetMap)
 *  which covers the whole UK incl. Northern Ireland. Returns null when nothing matches
 *  (e.g. "Yorkshire", typos, regions in no gazetteer). */
export async function geocodePlace(query: string): Promise<GeocodedPlace | null> {
  return (await geocodeViaPlaces(query)) ?? (await geocodeViaNominatim(query))
}

async function geocodeViaPlaces(query: string): Promise<GeocodedPlace | null> {
  const r = await getJson(`${BASE}/places?q=${encodeURIComponent(query.trim())}&limit=1`)
  const p = Array.isArray(r) ? r[0] : null
  if (!p || typeof p.longitude !== 'number' || typeof p.latitude !== 'number') {
    return null
  }
  // Eastings/northings are in metres; fall back to 0 extent if the box is absent.
  const widthKm =
    typeof p.max_eastings === 'number' && typeof p.min_eastings === 'number'
      ? (p.max_eastings - p.min_eastings) / 1000
      : 0
  const heightKm =
    typeof p.max_northings === 'number' && typeof p.min_northings === 'number'
      ? (p.max_northings - p.min_northings) / 1000
      : 0
  return {
    name: p.name_1 ?? query.trim(),
    longitude: p.longitude,
    latitude: p.latitude,
    extentKm: Math.max(widthKm, heightKm),
  }
}

// Best-effort fallback for places postcodes.io can't see — chiefly Northern Ireland
// towns (Belfast, Omagh…), which OS Open Names omits. Honours Nominatim's usage policy
// (descriptive User-Agent, single request, low volume). `countrycodes=gb` covers the
// whole UK including NI.
async function geocodeViaNominatim(query: string): Promise<GeocodedPlace | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query.trim(),
    )}&countrycodes=gb&format=jsonv2&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Custodian/1.0 (grant management; deprivation lookup)' },
    })
    if (!res.ok) return null
    const arr = (await res.json()) as any[]
    const p = Array.isArray(arr) ? arr[0] : null
    // Only accept settlements / administrative areas. This rejects fuzzy matches to
    // streets, buildings, etc. (e.g. "north of england" → a building called "North"),
    // which would otherwise resolve to a wrong, confident decile.
    if (p?.category !== 'place' && p?.category !== 'boundary') return null
    const lat = Number(p?.lat)
    const lon = Number(p?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    // boundingbox is [south, north, west, east] in degrees → convert to km.
    const bb = (p.boundingbox ?? []).map(Number)
    let extentKm = 0
    if (bb.length === 4 && bb.every((n: number) => Number.isFinite(n))) {
      const [south, north, west, east] = bb as [number, number, number, number]
      const latKm = Math.abs(north - south) * 111
      const lonKm = Math.abs(east - west) * 111 * Math.cos((((south + north) / 2) * Math.PI) / 180)
      extentKm = Math.max(latKm, lonKm)
    }
    return {
      name: p.name ?? String(p.display_name ?? query).split(',')[0] ?? query.trim(),
      longitude: lon,
      latitude: lat,
      extentKm,
    }
  } catch {
    return null
  }
}
