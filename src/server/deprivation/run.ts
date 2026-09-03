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
import { geocodePlace, reportingLevel, sameAreaName, type ReportingLevel } from './googleGeocode'
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
async function areasByPfa(pfaName: string): Promise<AreaRow[]> {
  return getDb().select().from(deprivationAreas).where(eq(deprivationAreas.pfaName, pfaName))
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

type LookupLevel = 'ward' | 'lad' | 'pfa' | 'region'

const WIDENING: Record<ReportingLevel, ReadonlyArray<LookupLevel>> = {
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
    at === 'ward' ? rev.wardCode : at === 'lad' ? rev.ladCode : at === 'pfa' ? rev.pfa : rev.region
  if (!key) return null

  const rows =
    at === 'ward'
      ? await areasByWard(key)
      : at === 'lad'
        ? await areasByLad(key)
        : at === 'pfa'
          ? await areasByPfa(key)
          : await areasByRegion(key)
  if (!rows.length) return null

  const name =
    at === 'ward' ? rev.wardName : at === 'lad' ? rev.ladName : at === 'pfa' ? rev.pfa : rev.region
  return contextFromRows(rows, at, name ?? placeName, 'place')
}
