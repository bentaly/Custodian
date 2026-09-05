// ─── Deprivation resolution ──────────────────────────────────────────────────
//
// Turns an application's free-text `geography` into a DeprivationResult. Three
// layers, each doing the one thing only it can do:
//
//   Google Geocoding   free text → a place, its coordinate, and what KIND of thing
//                      it is (`googleGeocode.ts`)
//   postcodes.io       postcode → LSOA code; coordinate → ward/LAD/region GSS codes
//                      (`postcodesIo.ts`)
//   deprivation_areas  those codes → a decile spread (seeded by seed-deprivation.ts)
//
// The middle layer is why Google cannot simply replace the rest: it returns places,
// never GSS codes, and GSS codes are the only thing our table joins on.
//
// The flow, per input:
//   • looks like a postcode  → forward lookup → its single LSOA → one decile
//   • a street address       → geocode → reverse geocode → its single LSOA → one
//                              decile. The same answer the postcode branch gives, and
//                              deliberately so: "22 The Greenway, EN6 2ND" and
//                              "EN6 2ND" are the same house and must not disagree.
//   • a place name           → geocode → reverse geocode → `reportingLevel` picks
//                              ward / LAD / PFA / region from what Google matched and
//                              the district it landed in → those LSOAs → a spread
//   • nothing matched        → unresolvable (a verdict on the text)
//   • could not ask          → pending     (a fact about us — see GeocodeOutcome)
//
// Like due diligence and scoring, this never throws — application creation is
// never blocked by it.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { deprivationAreas } from '../../../drizzle/schema'
import {
  decileStats,
  looksLikePostcode,
  LAD_EXTENT_KM,
  type DeprivationContext,
  type DeprivationResult,
} from '../../lib/deprivation/types'
import {
  geocodePlace,
  reportingLevel,
  sameAreaName,
  type GeocodeOutcome,
  type ReportingLevel,
} from './googleGeocode'
import { lookupPostcode, reverseGeocode, type PostcodeArea } from './postcodesIo'

/**
 * Only the columns a reading is built from — NOT `select()`.
 *
 * These queries are wide (a region is 4,567 rows, a police force area up to 1,702) and
 * every column comes back over HTTP on the neon-http driver. Measured against staging,
 * on the same connection, same rows:
 *
 *   count(*)  region=North West                1 row      51ms
 *   decile    region=North West            4,567 rows    527ms
 *   SELECT *  region=North West            4,567 rows  10,508ms
 *
 * Twenty times slower purely from hauling back eight columns nothing reads. That is
 * well past `getDb()`'s 4s query timeout, so the region lookup — the fallback EVERY
 * county-sized delivery area lands on — was throwing rather than answering. It went
 * unnoticed because the backfill scripts use a raw driver with no timeout, so the
 * hand-run corrections all succeeded; a submission arriving through /api/apply did not.
 *
 * `decile` is the only per-row value; the rest are constant across the set and read
 * off the first row, so this is the whole shape a `DeprivationContext` needs.
 */
const AREA_COLUMNS = {
  decile: deprivationAreas.decile,
  name: deprivationAreas.name,
  nation: deprivationAreas.nation,
  vintage: deprivationAreas.vintage,
  regionName: deprivationAreas.regionName,
  ladCode: deprivationAreas.ladCode,
  ladName: deprivationAreas.ladName,
} as const

type AreaRow = {
  [K in keyof typeof AREA_COLUMNS]: (typeof deprivationAreas.$inferSelect)[K]
}

async function areasByCode(code: string): Promise<AreaRow[]> {
  return getDb().select(AREA_COLUMNS).from(deprivationAreas).where(eq(deprivationAreas.code, code))
}
async function areasByWard(wardCode: string): Promise<AreaRow[]> {
  return getDb()
    .select(AREA_COLUMNS)
    .from(deprivationAreas)
    .where(eq(deprivationAreas.wardCode, wardCode))
}
async function areasByLad(ladCode: string): Promise<AreaRow[]> {
  return getDb()
    .select(AREA_COLUMNS)
    .from(deprivationAreas)
    .where(eq(deprivationAreas.ladCode, ladCode))
}
async function areasByRegion(regionName: string): Promise<AreaRow[]> {
  return getDb()
    .select(AREA_COLUMNS)
    .from(deprivationAreas)
    .where(eq(deprivationAreas.regionName, regionName))
}
async function areasByPfa(pfaName: string): Promise<AreaRow[]> {
  return getDb()
    .select(AREA_COLUMNS)
    .from(deprivationAreas)
    .where(eq(deprivationAreas.pfaName, pfaName))
}

/** Assemble a resolved context from a set of reference rows (all in one nation). */
function contextFromRows(
  rows: AreaRow[],
  areaType: DeprivationContext['areaType'],
  areaName: string,
  resolvedVia: DeprivationContext['resolvedVia'],
): DeprivationContext {
  const head = rows[0]!
  return {
    ...decileStats(rows.map((r) => r.decile)),
    nation: head.nation,
    vintage: head.vintage,
    areaType,
    areaName,
    resolvedVia,
    regionName: head.regionName,
    // A region- or county-level match spans many LADs, so a single district isn't
    // meaningful there — Merseyside is five of them.
    ladCode: areaType === 'region' || areaType === 'pfa' ? null : head.ladCode,
    ladName: areaType === 'region' || areaType === 'pfa' ? null : head.ladName,
  }
}

/**
 * The intermediate steps, filled in as resolution runs. Optional and write-only, so
 * the production path is untouched when nobody passes one.
 *
 * It exists because the failure this module was rewritten for was INVISIBLE:
 * "Preston" resolved to East Lothian and looked exactly like a correct answer on the
 * application, which is how it survived for months. The only way to catch a wrong
 * match is to see what was matched, what KIND of thing it was, and which geography
 * that justified. Both the CLI probe and the admin app's Location probe read this
 * rather than re-running the steps themselves — re-running would cost a second
 * Google call and could explain an answer different from the one being shown.
 */
export interface ResolveTrace {
  google?: GeocodeOutcome
  area?: PostcodeArea | null
  level?: ReportingLevel
}

export async function resolveDeprivation(
  location: string | null | undefined,
  trace?: ResolveTrace,
): Promise<DeprivationResult> {
  const input = location?.trim()
  if (!input) return { status: 'pending' }

  // ── Postcode → single LSOA ──────────────────────────────────────────────────
  if (looksLikePostcode(input)) {
    const area = await lookupPostcode(input)
    if (trace) trace.area = area
    if (!area?.lsoaCode) return { status: 'unresolvable', input }
    const rows = await areasByCode(area.lsoaCode)
    if (!rows.length) return { status: 'unresolvable', input }
    return {
      status: 'resolved',
      input,
      ...contextFromRows(rows, 'lsoa', area.lsoaName ?? rows[0]!.name, 'postcode'),
    }
  }

  // ── Place name → the level Google's answer justifies ────────────────────────
  const outcome = await geocodePlace(input)
  if (trace) trace.google = outcome
  // "We could not ask" is not "there is no such place". `pending` says not-run-yet
  // and is what `rerun-deprivation.ts --pending` comes back for; `unresolvable` is
  // a verdict a grants officer reads and acts on. See `GeocodeOutcome`.
  if (outcome.kind === 'unavailable') return { status: 'pending' }
  if (outcome.kind === 'no_match') return { status: 'unresolvable', input }
  const place = outcome.place

  // Reverse geocode first: the level depends on the district the coordinate lands
  // in, because "is this the whole district or a place inside one?" is the question
  // that decides ward vs LAD. See `reportingLevel`.
  const rev = await reverseGeocode(place.longitude, place.latitude)
  if (trace) trace.area = rev
  if (!rev) return { status: 'unresolvable', input }

  const level = reportingLevel(place, rev, LAD_EXTENT_KM)
  if (trace) trace.level = level

  // Widen, never narrow. The chosen level is the right answer; the ones after it
  // are there because our table may not carry the code postcodes.io returned (a
  // Scottish ward, say), and a wider real area beats no answer at all.
  for (const at of WIDENING[level]) {
    const found = await lookupAt(at, rev, place.name)
    if (found) return { status: 'resolved', input, ...found }
  }

  // Nothing to anchor to — a country, or a region-sized place outside England
  // (which has no statistical region) — so decline rather than guess.
  return { status: 'too_broad', input, matchedName: place.name, extentKm: place.extentKm }
}

type LookupLevel = 'lsoa' | 'ward' | 'lad' | 'pfa' | 'region'

const WIDENING: Record<ReportingLevel, ReadonlyArray<LookupLevel>> = {
  // An address widens to its ward for the same reason every other level widens: our
  // table may not carry the LSOA code postcodes.io returned. The ward containing the
  // house is a wider real answer, not a different one.
  lsoa: ['lsoa', 'ward', 'lad', 'region'],
  ward: ['ward', 'lad', 'region'],
  lad: ['lad', 'region'],
  // A county that does not match a police force area — "Buckinghamshire" against
  // "Thames Valley", "Tyne and Wear" against "Northumbria" — falls back to the
  // region, which is exactly what it did before the PFA column existed.
  pfa: ['pfa', 'region'],
  region: ['region'],
  too_broad: [],
}

/** One level's lookup, or null if it has no code, our table doesn't carry it, or —
 *  for a PFA — the applicant did not actually name that force area. */
async function lookupAt(
  at: LookupLevel,
  rev: PostcodeArea,
  placeName: string,
): Promise<DeprivationContext | null> {
  // A PFA is reached by NAME, not by the coordinate landing in it. Every coordinate
  // lands in some force area, so without this "Buckinghamshire" would silently
  // return the whole of Thames Valley. The other three are genuine containments.
  if (at === 'pfa' && !sameAreaName(placeName, rev.pfa)) return null

  const key =
    at === 'lsoa'
      ? rev.lsoaCode
      : at === 'ward'
        ? rev.wardCode
        : at === 'lad'
          ? rev.ladCode
          : at === 'pfa'
            ? rev.pfa
            : rev.region
  if (!key) return null

  const rows =
    at === 'lsoa'
      ? await areasByCode(key)
      : at === 'ward'
        ? await areasByWard(key)
        : at === 'lad'
          ? await areasByLad(key)
          : at === 'pfa'
            ? await areasByPfa(key)
            : await areasByRegion(key)
  if (!rows.length) return null

  const name =
    at === 'lsoa'
      ? rev.lsoaName
      : at === 'ward'
        ? rev.wardName
        : at === 'lad'
          ? rev.ladName
          : at === 'pfa'
            ? rev.pfa
            : rev.region
  return contextFromRows(rows, at, name ?? placeName, 'place')
}
