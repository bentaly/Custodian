/**
 * Populates `deprivation_areas.pfa_name` from the ONS LAD→PFA lookup.
 *
 *   pnpm tsx scripts/backfill-pfa.ts          # dry run
 *   pnpm tsx scripts/backfill-pfa.ts --apply  # write
 *
 * This is what lets a COUNTY-shaped delivery area resolve. Foundations write
 * "Merseyside" or "Greater Manchester" constantly and neither is a local authority —
 * Merseyside is five of them — so before this they fell out to "North West, deciles
 * 1–10", the entire region, which tells a trustee nothing.
 *
 * Police force areas are used because ONS publishes no current lookup for the
 * ceremonial counties people actually mean: its only "County" service is the 2017
 * ADMINISTRATIVE one, which has no metropolitan counties at all and predates
 * Cumbria's 2023 abolition. PFAs are built from ceremonial counties, are maintained
 * (LAD25→PFA25), and carry the names foundations use. Merseyside comes back as
 * exactly Liverpool, Sefton, Knowsley, St Helens and Wirral.
 *
 * Where a PFA is NOT a county the resolver simply never matches it — see the exact
 * name check in `lookupAt`. So "Thames Valley" being one force over sixteen
 * districts costs nothing: "Buckinghamshire" fails the name check and falls back to
 * the region, exactly as it does today.
 *
 * Re-runnable, and safe to re-run when ONS republishes. England & Wales only —
 * Scotland and NI have single national forces, so there is nothing county-shaped to
 * map and their rows stay null.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { deprivationAreas } from '../drizzle/schema'

const LOOKUP =
  'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LAD25_CSP25_PFA25_EW_LU/FeatureServer/0/query' +
  '?where=1%3D1&outFields=LAD25CD,LAD25NM,PFA25NM&returnGeometry=false&resultRecordCount=2000&f=json'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

async function ladToPfa(): Promise<Map<string, string>> {
  const res = await fetch(LOOKUP)
  if (!res.ok) throw new Error(`ONS lookup failed: HTTP ${res.status}`)
  const body = (await res.json()) as { features?: Array<{ attributes: Record<string, string> }> }
  const map = new Map<string, string>()
  // The lookup is per Community Safety Partnership, so a district appears once per
  // CSP within it — several times for the big ones. Every row agrees on the PFA.
  for (const f of body.features ?? []) {
    const lad = f.attributes['LAD25CD']
    const pfa = f.attributes['PFA25NM']
    if (lad && pfa) map.set(lad, pfa)
  }
  if (map.size < 300) throw new Error(`only ${map.size} districts in the lookup — refusing`)
  return map
}

async function main() {
  const apply = process.argv.includes('--apply')
  const map = await ladToPfa()
  console.log(`ONS lookup: ${map.size} districts → ${new Set(map.values()).size} force areas\n`)

  const ours = await db
    .select({
      ladCode: deprivationAreas.ladCode,
      nation: deprivationAreas.nation,
      n: sql<number>`count(*)::int`,
    })
    .from(deprivationAreas)
    .groupBy(deprivationAreas.ladCode, deprivationAreas.nation)

  const matched = ours.filter((r) => map.has(r.ladCode))
  const missing = ours.filter((r) => !map.has(r.ladCode))

  console.log(`deprivation_areas: ${ours.length} districts, ${sum(ours)} rows`)
  console.log(`  will set   ${matched.length} districts / ${sum(matched)} rows`)
  console.log(`  left null  ${missing.length} districts / ${sum(missing)} rows`)
  // Broken down by nation, because "7,866 rows left null" is only reassuring once you
  // can see they are Scotland and Northern Ireland — which have single national
  // forces, so there is nothing county-shaped for them to map onto. A nation that
  // came back PARTIAL would mean the ONS lookup had moved under us.
  const byNation = new Map<string, { total: number; unmapped: number }>()
  for (const r of ours) {
    const e = byNation.get(r.nation) ?? { total: 0, unmapped: 0 }
    e.total += 1
    if (!map.has(r.ladCode)) e.unmapped += 1
    byNation.set(r.nation, e)
  }
  console.log('\n  districts by nation (mapped / total):')
  for (const [nation, e] of [...byNation].sort()) {
    const partial = e.unmapped > 0 && e.unmapped < e.total
    console.log(
      `    ${nation.padEnd(18)} ${e.total - e.unmapped}/${e.total}` +
        (partial ? '   <- PARTIAL, check the ONS lookup' : ''),
    )
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  console.log(`\nWriting ${matched.length} districts…`)
  let done = 0
  for (const row of matched) {
    await db
      .update(deprivationAreas)
      .set({ pfaName: map.get(row.ladCode)! })
      .where(eq(deprivationAreas.ladCode, row.ladCode))
    if (++done % 50 === 0) console.log(`  ${done}/${matched.length}`)
  }

  const filled = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deprivationAreas)
    .where(sql`${deprivationAreas.pfaName} is not null`)
  console.log(`\nDone. ${filled[0]?.n ?? 0} rows now carry a force area.`)
}

const sum = (rows: Array<{ n: number }>) => rows.reduce((t, r) => t + r.n, 0)

main().then(() => process.exit(0))
