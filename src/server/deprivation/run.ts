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
//   • a place name           → geocode → reverse geocode → `reportingLevel` picks
//                              ward / LAD / region from what Google matched and the
//                              district it landed in → that area's LSOAs → a spread
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
import { geocodePlace, reportingLevel, type ReportingLevel } from './googleGeocode'
import { lookupPostcode, reverseGeocode, type PostcodeArea } from './postcodesIo'

type AreaRow = typeof deprivationAreas.$inferSelect

async function areasByCode(code: string): Promise<AreaRow[]> {
  return getDb().select().from(deprivationAreas).where(eq(deprivationAreas.code, code))
}
async function areasByWard(wardCode: string): Promise<AreaRow[]> {
  return getDb().select().from(deprivationAreas).where(eq(deprivationAreas.wardCode, wardCode))
}
async function areasByLad(ladCode: string): Promise<AreaRow[]> {
  return getDb().select().from(deprivationAreas).where(eq(deprivationAreas.ladCode, ladCode))
}
async function areasByRegion(regionName: string): Promise<AreaRow[]> {
  return getDb().select().from(deprivationAreas).where(eq(deprivationAreas.regionName, regionName))
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
    // A region-level match spans many LADs, so a single district isn't meaningful there.
    ladCode: areaType === 'region' ? null : head.ladCode,
    ladName: areaType === 'region' ? null : head.ladName,
  }
}

export async function resolveDeprivation(
  location: string | null | undefined,
): Promise<DeprivationResult> {
  const input = location?.trim()
  if (!input) return { status: 'pending' }

  // ── Postcode → single LSOA ──────────────────────────────────────────────────
  if (looksLikePostcode(input)) {
    const area = await lookupPostcode(input)
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
  if (!rev) return { status: 'unresolvable', input }

  const level = reportingLevel(place, rev.ladName, LAD_EXTENT_KM)

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

const WIDENING: Record<ReportingLevel, ReadonlyArray<'ward' | 'lad' | 'region'>> = {
  ward: ['ward', 'lad', 'region'],
  lad: ['lad', 'region'],
  region: ['region'],
  too_broad: [],
}

/** One level's lookup, or null if it has no code or our table doesn't carry it. */
async function lookupAt(
  at: 'ward' | 'lad' | 'region',
  rev: PostcodeArea,
  placeName: string,
): Promise<DeprivationContext | null> {
  const code = at === 'ward' ? rev.wardCode : at === 'lad' ? rev.ladCode : rev.region
  if (!code) return null
  const rows =
    at === 'ward'
      ? await areasByWard(code)
      : at === 'lad'
        ? await areasByLad(code)
        : await areasByRegion(code)
  if (!rows.length) return null
  const name = at === 'ward' ? rev.wardName : at === 'lad' ? rev.ladName : rev.region
  return contextFromRows(rows, at, name ?? placeName, 'place')
}
