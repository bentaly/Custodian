/**
 * Diagnostic: show, for each delivery area, exactly what Google matched and what
 * geography that justifies — WITHOUT writing anything.
 *
 *   pnpm tsx scripts/probe-deprivation.ts "Preston" "Merseyside"
 *   pnpm tsx scripts/probe-deprivation.ts --csv ~/Downloads/Arete.csv
 *
 * This exists because the failure it was written for was invisible: "Preston"
 * resolved to East Lothian and looked exactly like a correct answer on screen.
 * The point is to see the intermediate steps — what Google matched, its `types`,
 * its footprint, which level that picks — before any of it is written to a row.
 *
 * Needs GOOGLE_MAPS_API_KEY and DATABASE_URL (for the deprivation_areas lookups,
 * which are reference data and identical on staging and prod).
 */
import { config } from 'dotenv'
config()

import { readFile } from 'node:fs/promises'
import { resolveDeprivation, type ResolveTrace } from '../src/server/deprivation/run'
import { formatDecileRange } from '../src/lib/deprivation/types'

/** Second column of a CSV whose header row is found, not assumed — see
 *  set-arete-delivery-area.ts for why the export has a title row above it. */
async function locationsFromCsv(path: string): Promise<string[]> {
  const text = await readFile(path, 'utf8')
  const rows = text.split(/\r?\n/).map((line) => {
    const cells: string[] = []
    let field = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      if (quoted) {
        if (c !== '"') field += c
        else if (line[i + 1] === '"') ((field += '"'), i++)
        else quoted = false
      } else if (c === '"') quoted = true
      else if (c === ',') (cells.push(field), (field = ''))
      else field += c
    }
    cells.push(field)
    return cells
  })
  const headerAt = rows.findIndex((r) => (r[0] ?? '').trim().toLowerCase() === 'organisation name')
  return rows
    .slice(headerAt + 1)
    .map((r) => (r[1] ?? '').trim())
    .filter(Boolean)
}

async function main() {
  const args = process.argv.slice(2)
  const csvAt = args.indexOf('--csv')
  const locations = csvAt === -1 ? args : await locationsFromCsv(args[csvAt + 1] ?? '')

  if (!locations.length) {
    throw new Error('usage: probe-deprivation.ts <place>… | --csv <file.csv>')
  }
  if (!process.env['GOOGLE_MAPS_API_KEY']) {
    console.warn('! GOOGLE_MAPS_API_KEY is not set — every lookup will report unavailable.\n')
  }

  for (const input of locations) {
    console.log(`\n${'─'.repeat(70)}\n${input}`)

    // One pass of the real resolver, reporting its own intermediate steps — rather
    // than re-running the pieces here, which would double the Google calls and could
    // explain an answer different from the one printed.
    const trace: ResolveTrace = {}
    const r = await resolveDeprivation(input, trace)

    const g = trace.google
    if (g == null) {
      console.log('  google      not called (postcode branch)')
    } else if (g.kind === 'match') {
      const p = g.place
      console.log(`  google      "${p.name}"  [${p.types.join(', ') || 'no types'}]`)
      console.log(
        `  footprint   ${p.extentKm.toFixed(2)} km` +
          `   location_type=${p.locationType ?? '—'}` +
          `   partial_match=${p.partialMatch}`,
      )
    } else {
      console.log(`  google      ${g.kind}${g.kind === 'unavailable' ? ` (${g.reason})` : ''}`)
    }

    const a = trace.area
    if (a) {
      console.log(
        `  postcodes.io ward=${a.wardName ?? '—'}  lad=${a.ladName ?? '—'}` +
          `  pfa=${a.pfa ?? '—'}  region=${a.region ?? '—'}  (${a.country ?? '—'})`,
      )
    }
    if (trace.level) console.log(`  level       ${trace.level}`)

    if (r.status === 'resolved') {
      console.log(
        `  RESULT      ${formatDecileRange(r)} (typically ${r.median})` +
          `  ·  ${r.areaName} · ${r.areaType} · ${r.count} neighbourhoods · ${r.vintage}`,
      )
    } else if (r.status === 'too_broad') {
      console.log(
        `  RESULT      too_broad — matched "${r.matchedName}" at ${r.extentKm.toFixed(1)} km`,
      )
    } else {
      console.log(`  RESULT      ${r.status}`)
    }
  }
  console.log()
}

main().then(() => process.exit(0))
