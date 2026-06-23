/**
 * Seeds the `deprivation_areas` reference table — one row per UK small area carrying
 * its nation's LATEST Index of Multiple Deprivation decile. Run once, then again only
 * when a nation republishes its index (every ~5 years).
 *
 *   pnpm tsx scripts/seed-deprivation.ts
 *
 * It reads CSVs you download into  data/deprivation/  (gitignored — the files are a
 * few MB and public). Nothing here calls a paid API; the decile data is the official
 * open data, and resolution-time geocoding is handled separately by postcodes.io.
 *
 * ── Where to get each file (download the CSV variants) ────────────────────────────
 *  England  — IoD2025 "File 1: index of multiple deprivation" (LSOA 2021, rank+decile,
 *             incl. LAD code/name):   https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025
 *           + LSOA(2021)→Ward→LAD and LSOA→Region lookups (for ward + region columns):
 *             https://geoportal.statistics.gov.uk  (search "LSOA (2021) to Ward to LAD")
 *  Wales    — WIMD 2025 (LSOA rank+decile):  https://www.gov.wales/welsh-index-multiple-deprivation-2025
 *  Scotland — SIMD 2020 (Data Zone rank+decile + LAD):  https://simd.scot / gov.scot
 *  N.Ireland— NIMDM 2017 (SOA rank+decile + LGD):  https://www.nisra.gov.uk/statistics/deprivation
 *
 * ⚠️  Column header names below are placeholders — open each CSV and set the real
 *     headers in the per-nation config. Ward/Region exist for England only.
 */
import { config } from 'dotenv'
config()

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { sql } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { deprivationAreas } from '../drizzle/schema'
import { nationFromGssCode, NATION_VINTAGE } from '../src/lib/deprivation/types'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })
const DATA_DIR = join(process.cwd(), 'data', 'deprivation')

type Row = typeof deprivationAreas.$inferInsert

// ── Minimal CSV reader (handles quoted fields + embedded commas) ─────────────────
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' }
      if (c === '\r' && text[i + 1] === '\n') i++
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift() ?? []
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

function loadCsv(file: string): Record<string, string>[] {
  return parseCsv(readFileSync(join(DATA_DIR, file), 'utf8').replace(/^﻿/, ''))
}

// Index a lookup CSV by its small-area code for O(1) joins.
function indexBy(rows: Record<string, string>[], codeCol: string): Map<string, Record<string, string>> {
  return new Map(rows.map((r) => [r[codeCol]!, r]))
}

// Decile from a within-nation rank (1 = most deprived) when no decile column exists.
// Needed for Northern Ireland, whose NIMDM file publishes only a rank.
function decileFromRank(rank: number, totalAreas: number): number {
  return Math.min(10, Math.max(1, Math.ceil((rank / totalAreas) * 10)))
}

// Source filenames (as downloaded into data/deprivation/ — see README).
const FILES = {
  england: 'File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv',
  wales: 'welsh-index-of-multiple-deprivation-wimd-2025-index-and-domain-ranks-and-groups-for-lower-layer-super-output-areas-lsoa-v7-en-gb.csv',
  scotland: 'simd2020v2_22062020.csv',
  ni: 'nimdm2017-soa.csv',
  // ONS lookups cover England AND Wales ("EW"), so both nations share them.
  ewWard: 'LSOA_(2021)_to_Electoral_Ward_(2025)_to_LAD_(2025)_Best_Fit_Lookup_in_EW_v2.csv',
  ewRegion: 'LSOA_(2021)_to_Built_Up_Area_to_Local_Authority_District_to_Region_(December_2022)_Lookup_in_England_and_Wales_v2.csv',
}

interface Geo { wardCode: string | null; ladCode: string; ladName: string; regionName: string | null }

// Build a single LSOA(2021) → {ward, LAD, region} map from the two ONS EW lookups,
// shared by both England and Wales (their IMD files lack ward/region, and Wales lacks
// LAD entirely). Welsh LSOAs resolve their region to "Wales".
function buildGeography(): Map<string, Geo> {
  const ward = indexBy(loadCsv(FILES.ewWard), 'LSOA21CD')
  const region = indexBy(loadCsv(FILES.ewRegion), 'LSOA21CD')
  const map = new Map<string, Geo>()
  for (const code of new Set([...ward.keys(), ...region.keys()])) {
    const w = ward.get(code)
    map.set(code, {
      wardCode: w?.['WD25CD'] ?? null,
      ladCode: w?.['LAD25CD'] ?? '',
      ladName: w?.['LAD25NM'] ?? '',
      regionName: region.get(code)?.['RGN22NM'] ?? null,
    })
  }
  return map
}

// ── Per-nation builders ──────────────────────────────────────────────────────────
// Each returns the assembled rows for that nation. Kept explicit (not a generic
// config) because the four sources differ in shape; the shared output is `Row`.
// Column names are confirmed against the live files.

function buildEngland(geo: Map<string, Geo>): Row[] {
  // File 7 (CSV) carries code/name/decile/rank (+ a 2024 LAD, used as a fallback when
  // the 2025 EW lookup is missing a row).
  return loadCsv(FILES.england).map((r): Row => {
    const code = r['LSOA code (2021)']!
    const g = geo.get(code)
    return {
      code,
      name: r['LSOA name (2021)'] ?? code,
      wardCode: g?.wardCode ?? null,
      ladCode: g?.ladCode || r['Local Authority District code (2024)']!,
      ladName: g?.ladName || r['Local Authority District name (2024)'] || '',
      regionName: g?.regionName ?? null,
      nation: 'england',
      decile: Number(r['Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOAs)']),
      rank: Number(r['Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)']) || null,
      vintage: NATION_VINTAGE.england,
    }
  })
}

function buildWales(geo: Map<string, Geo>): Row[] {
  // StatsWales "long" format: one row per area × domain × measure. Keep the overall
  // index (Domain = "WIMD") and pivot its Rank + Decile rows back together per LSOA.
  const byArea = new Map<string, { name: string; rank?: number; decile?: number }>()
  for (const r of loadCsv(FILES.wales)) {
    if (r['Domain'] !== 'WIMD') continue
    const code = r['Area code']
    const measure = r['Data description']
    if (!code || (measure !== 'Rank' && measure !== 'Decile')) continue
    const e = byArea.get(code) ?? { name: r['Area name'] || code }
    const value = Number((r['Data values'] ?? '').replace(/\s/g, '')) // values are space-padded
    if (measure === 'Rank') e.rank = value
    else e.decile = value
    byArea.set(code, e)
  }
  return [...byArea].map(([code, e]): Row => {
    const g = geo.get(code)
    return {
      code,
      name: e.name,
      wardCode: g?.wardCode ?? null,
      ladCode: g?.ladCode ?? '',
      ladName: g?.ladName ?? '',
      regionName: g?.regionName ?? null, // "Wales" for Welsh LSOAs
      nation: 'wales',
      decile: e.decile ?? NaN,
      rank: Number.isFinite(e.rank) ? e.rank! : null,
      vintage: NATION_VINTAGE.wales,
    }
  })
}

// The Scottish SIMD file gives council-area CODES only, no names. Static lookup of the
// 32 council areas (S12 GSS codes → names) so the "funding by district" breakdown has
// labels for Scotland too. Stable — councils rarely change.
const SCOTLAND_LAD_NAMES: Record<string, string> = {
  S12000005: 'Clackmannanshire', S12000006: 'Dumfries and Galloway', S12000008: 'East Ayrshire',
  S12000010: 'East Lothian', S12000011: 'East Renfrewshire', S12000013: 'Na h-Eileanan Siar',
  S12000014: 'Falkirk', S12000017: 'Highland', S12000018: 'Inverclyde', S12000019: 'Midlothian',
  S12000020: 'Moray', S12000021: 'North Ayrshire', S12000023: 'Orkney Islands',
  S12000026: 'Scottish Borders', S12000027: 'Shetland Islands', S12000028: 'South Ayrshire',
  S12000029: 'South Lanarkshire', S12000030: 'Stirling', S12000033: 'Aberdeen City',
  S12000034: 'Aberdeenshire', S12000035: 'Argyll and Bute', S12000036: 'City of Edinburgh',
  S12000038: 'Renfrewshire', S12000039: 'West Dunbartonshire', S12000040: 'West Lothian',
  S12000041: 'Angus', S12000042: 'Dundee City', S12000045: 'East Dunbartonshire',
  S12000047: 'Fife', S12000048: 'Perth and Kinross', S12000049: 'Glasgow City',
  S12000050: 'North Lanarkshire',
}

function buildScotland(): Row[] {
  // NHS Open Data CSV: decile + rank + data zone + council area code. `CA` is the S12…
  // council GSS code, which matches postcodes.io's admin_district for the LAD-tier range.
  return loadCsv(FILES.scotland).map((r): Row => {
    const ca = r['CA']!
    return {
      code: r['DataZone']!,
      name: r['DataZone']!,
      wardCode: null,
      ladCode: ca,
      ladName: SCOTLAND_LAD_NAMES[ca] ?? '',
      regionName: null,
      nation: 'scotland',
      decile: Number(r['SIMD2020V2CountryDecile']),
      rank: Number(r['SIMD2020V2Rank']) || null,
      vintage: NATION_VINTAGE.scotland,
    }
  })
}

const NI_TOTAL_SOAS = 890 // NIMDM2017 ranks 890 SOAs; decile derived from rank.

function buildNorthernIreland(): Row[] {
  // Open Data NI "NIMDM 2017 - SOA" CSV. Keyed on the legacy SOA2001 code (e.g.
  // "95AA01S1") — this matches postcodes.io's `lsoa11` field for NI postcodes. No
  // decile column exists, so derive it from MDM_rank.
  return loadCsv(FILES.ni).map((r): Row => {
    const rank = Number(r['MDM_rank'])
    return {
      code: r['SOA2001']!,
      name: r['SOA2001name'] ?? r['SOA2001']!,
      wardCode: null,
      ladCode: r['LGD2014code']!,
      ladName: r['LGD2014name'] ?? '',
      regionName: null,
      nation: 'northern_ireland',
      decile: decileFromRank(rank, NI_TOTAL_SOAS),
      rank: Number.isFinite(rank) ? rank : null,
      vintage: NATION_VINTAGE.northern_ireland,
    }
  })
}

async function upsert(rows: Row[]) {
  const valid = rows.filter(
    (r) => r.code && nationFromGssCode(r.code) && Number.isFinite(r.decile) && r.decile >= 1 && r.decile <= 10,
  )
  const CHUNK = 1000
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK)
    await db
      .insert(deprivationAreas)
      .values(chunk)
      .onConflictDoUpdate({
        target: deprivationAreas.code,
        set: {
          name: sqlExcluded('name'),
          wardCode: sqlExcluded('ward_code'),
          ladCode: sqlExcluded('lad_code'),
          ladName: sqlExcluded('lad_name'),
          regionName: sqlExcluded('region_name'),
          nation: sqlExcluded('nation'),
          decile: sqlExcluded('decile'),
          rank: sqlExcluded('rank'),
          vintage: sqlExcluded('vintage'),
        },
      })
  }
  return valid.length
}

// Helper for ON CONFLICT … SET col = EXCLUDED.col
function sqlExcluded(col: string) {
  return sql.raw(`excluded.${col}`)
}

async function main() {
  // `--dry-run` parses the files and reports without writing to the database.
  const dryRun = process.argv.includes('--dry-run')
  // England + Wales share the ONS EW ward/region lookups — load them once.
  const geo = buildGeography()
  const builders: Array<[string, () => Row[]]> = [
    ['England', () => buildEngland(geo)],
    ['Wales', () => buildWales(geo)],
    ['Scotland', buildScotland],
    ['Northern Ireland', buildNorthernIreland],
  ]
  let total = 0
  for (const [name, build] of builders) {
    try {
      const rows = build()
      if (dryRun) {
        const valid = rows.filter((r) => Number.isFinite(r.decile) && r.decile >= 1 && r.decile <= 10)
        const withWard = valid.filter((r) => r.wardCode).length
        const withRegion = valid.filter((r) => r.regionName).length
        const sample = valid[0]
        console.log(
          `• ${name}: ${rows.length} rows, ${valid.length} valid · ward ${withWard} · region ${withRegion}\n    e.g. ${JSON.stringify(sample)}`,
        )
      } else {
        const n = await upsert(rows)
        console.log(`✓ ${name}: ${n} areas`)
        total += n
      }
    } catch (err) {
      console.error(`✗ ${name}: ${(err as Error).message}`)
    }
  }
  if (!dryRun) console.log(`Done — ${total} deprivation areas seeded.`)
}

main().then(() => process.exit(0))
