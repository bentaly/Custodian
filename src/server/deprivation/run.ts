// ─── Deprivation resolution ──────────────────────────────────────────────────
//
// Turns an application's free-text `geography` into a DeprivationResult by combining
// postcodes.io (geocode / reverse-geocode) with the local `deprivation_areas`
// reference table (the per-nation IMD deciles, seeded by scripts/seed-deprivation.ts).
//
// The flow, per input:
//   • looks like a postcode  → forward lookup → its single LSOA → one decile
//   • a place name           → geocode → bounding box decides granularity:
//        – town  (≤ WARD_EXTENT_KM)        → reverse geocode → ward → ward's LSOAs
//        – city  (≤ TOO_BROAD_EXTENT_KM)   → reverse geocode → LAD  → LAD's LSOAs
//        – region (> TOO_BROAD_EXTENT_KM)  → too_broad (a single decile would mislead)
//   • no match anywhere      → unresolvable
//
// Like due diligence and scoring, this never throws — any failure resolves to
// 'unresolvable' so application creation is never blocked.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { deprivationAreas } from '../../../drizzle/schema'
import {
  decileStats,
  looksLikePostcode,
  LAD_EXTENT_KM,
  WARD_EXTENT_KM,
  type DeprivationContext,
  type DeprivationResult,
} from '../../lib/deprivation/types'
import { geocodePlace, lookupPostcode, reverseGeocode } from './postcodesIo'

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

  // ── Place name → ward (town) / LAD (city) / region (e.g. London), else too broad ─
  const place = await geocodePlace(input)
  if (!place) return { status: 'unresolvable', input }

  const rev = await reverseGeocode(place.longitude, place.latitude)
  if (!rev) return { status: 'unresolvable', input }

  // A town snaps to its ward — the centroid's ward is representative at this size.
  if (place.extentKm <= WARD_EXTENT_KM && rev.wardCode) {
    const rows = await areasByWard(rev.wardCode)
    if (rows.length) {
      return {
        status: 'resolved',
        input,
        ...contextFromRows(rows, 'ward', rev.wardName ?? place.name, 'place'),
      }
    }
  }

  // A city sits within one LAD — use the LAD-wide spread.
  if (place.extentKm <= LAD_EXTENT_KM && rev.ladCode) {
    const rows = await areasByLad(rev.ladCode)
    if (rows.length) {
      return {
        status: 'resolved',
        input,
        ...contextFromRows(rows, 'lad', rev.ladName ?? place.name, 'place'),
      }
    }
  }

  // Larger than a LAD (e.g. "London") — the centroid's LAD is no longer
  // representative, so report the statistical region's spread instead.
  if (rev.region) {
    const rows = await areasByRegion(rev.region)
    if (rows.length) {
      return {
        status: 'resolved',
        input,
        ...contextFromRows(rows, 'region', rev.region, 'place'),
      }
    }
  }

  // Region-sized but no region to anchor to (non-England, or "North of England"
  // spanning several regions) — decline rather than guess.
  return { status: 'too_broad', input, matchedName: place.name, extentKm: place.extentKm }
}
