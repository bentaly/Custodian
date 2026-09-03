// ─── postcodes.io client ─────────────────────────────────────────────────────
//
// Thin wrapper over the free, key-less postcodes.io API. It does two jobs for
// deprivation resolution, and both are the same job seen from two directions —
// turning a location into the OFFICIAL GSS CODES that `deprivation_areas` joins on:
//   1. forward postcode lookup  → the postcode's LSOA/Data Zone/SOA code
//   2. reverse geocode          → the ward/LAD/region for a coordinate
//
// Place-name lookup used to live here too, against the OS Open Names gazetteer
// (`/places`) with a Nominatim fallback. Both are gone: see `googleGeocode.ts` for
// why they could not do the job and what replaced them. postcodes.io stays because
// it is the only free source of GSS codes, and Google never returns one.
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
  // Police Force Area NAME — how a county-shaped delivery area ("Merseyside",
  // "Greater Manchester", "Cumbria") gets answered. See `deprivation_areas.pfaName`
  // for why this stands in for a county and why it is only ever matched exactly.
  pfa: string | null
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
    pfa: r?.pfa ?? null,
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
