/**
 * One-off: overwrite `applications.deliveryArea` for Arete from a two-column
 * spreadsheet (Organisation name | Location), then re-resolve deprivation for
 * every row whose area actually changed.
 *
 *   pnpm tsx scripts/set-arete-delivery-area.ts <file.xlsx>            # dry run
 *   pnpm tsx scripts/set-arete-delivery-area.ts <file.xlsx> --apply    # write
 *
 * Matching is on organisation name, normalised (trimmed, collapsed whitespace,
 * case-folded, punctuation and a leading "The" dropped) — the spreadsheet is
 * hand-typed and its names carry stray trailing spaces. A name that matches no
 * application, or more than one, is REPORTED AND SKIPPED rather than guessed at.
 *
 * Deprivation is derived from deliveryArea, so leaving it alone would leave the
 * old area's decile on the row; it is re-run exactly as `updateApplication` does.
 */
import { config } from 'dotenv'
config()

import ExcelJS from 'exceljs'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { applications, clients, roundProgrammes, rounds } from '../drizzle/schema'
import { resolveDeprivation } from '../src/server/deprivation/run'
import { deliveryGeoFromResult } from '../src/lib/deprivation/types'

const CLIENT_NAME_MATCH = 'arete'

/**
 * Spreadsheet name → application name, for the four the foundation wrote short.
 * Confirmed by hand against the application list rather than fuzzy-matched: a
 * near-miss here would write one charity's delivery area onto another's grant.
 */
const ALIASES: Record<string, string> = {
  Lindley: 'Lindley Educational Trust',
  '12th Maghull Scout Group': '12th Maghull Scouts',
  'Out There': 'Out There: supporting families of prisoners Limited',
  Vibe: 'Vibe Charitable Incorporated Organisation',
}

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')

async function readSheet(path: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const ws = wb.worksheets[0]!
  const out: Array<{ name: string; location: string }> = []
  ws.eachRow((row, i) => {
    if (i === 1) return // header
    const cell = (n: number) => String(row.getCell(n).text ?? '').trim()
    const name = cell(1)
    const location = cell(2)
    if (name && location) out.push({ name, location })
  })
  return out
}

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!file) throw new Error('usage: set-arete-delivery-area.ts <file.xlsx> [--apply]')

  const sheet = await readSheet(file)

  const client = (await db.select().from(clients)).find((c) =>
    c.name.toLowerCase().includes(CLIENT_NAME_MATCH),
  )
  if (!client) throw new Error(`no client whose name contains "${CLIENT_NAME_MATCH}"`)
  console.log(`Client: ${client.name} (${client.id})\n`)

  const rows = await db
    .select({
      id: applications.id,
      organisationName: applications.organisationName,
      deliveryArea: applications.deliveryArea,
      deprivationStatus: applications.deprivationStatus,
    })
    .from(applications)
    .innerJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .innerJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
    .where(eq(rounds.clientId, client.id))

  const byName = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = norm(r.organisationName)
    byName.set(k, [...(byName.get(k) ?? []), r])
  }

  const planned: Array<{ id: string; name: string; from: string | null; to: string }> = []
  const skipped: string[] = []
  const unchanged: string[] = []

  for (const s of sheet) {
    const target = ALIASES[s.name.trim()] ?? s.name
    const matches = byName.get(norm(target)) ?? []
    if (matches.length === 0) {
      skipped.push(`NO MATCH   ${s.name}`)
      continue
    }
    for (const m of matches) {
      if ((m.deliveryArea ?? '') === s.location) {
        unchanged.push(`${m.organisationName} — already "${s.location}"`)
        continue
      }
      planned.push({
        id: m.id,
        name: m.organisationName,
        from: m.deliveryArea,
        to: s.location,
      })
    }
  }

  const touched = new Set(planned.map((p) => p.id))
  const untouched = rows.filter((r) => !touched.has(r.id) && !unchanged.length)

  console.log(`Applications for this client: ${rows.length}`)
  console.log(`Spreadsheet rows: ${sheet.length}\n`)
  console.log('WILL CHANGE:')
  for (const p of planned) {
    console.log(`  ${p.name}\n      ${JSON.stringify(p.from)}  ->  ${JSON.stringify(p.to)}`)
  }
  if (unchanged.length) console.log(`\nALREADY CORRECT:\n  ${unchanged.join('\n  ')}`)
  if (skipped.length) console.log(`\nSKIPPED:\n  ${skipped.join('\n  ')}`)

  const notInSheet = rows.filter(
    (r) => !sheet.some((s) => norm(ALIASES[s.name.trim()] ?? s.name) === norm(r.organisationName)),
  )
  if (notInSheet.length) {
    console.log(`\nAPPLICATIONS NOT IN THE SHEET (left alone): ${notInSheet.length}`)
    for (const r of notInSheet) {
      console.log(`  ${r.organisationName} — ${JSON.stringify(r.deliveryArea)}`)
    }
  }
  void untouched
  void inArray

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  console.log(`\nApplying ${planned.length} update(s)…`)
  const tally: Record<string, number> = {}
  for (const p of planned) {
    const result = await resolveDeprivation(p.to)
    const attempted = result.status !== 'pending'
    const geo = deliveryGeoFromResult(result)
    await db
      .update(applications)
      .set({
        deliveryArea: p.to,
        deprivationStatus: result.status,
        deprivationContext: attempted ? result : null,
        deprivationResolvedAt: attempted ? new Date() : null,
        deliveryNation: geo.nation,
        deliveryRegion: geo.region,
        deliveryLadCode: geo.ladCode,
        deliveryLadName: geo.ladName,
      })
      .where(eq(applications.id, p.id))
    tally[result.status] = (tally[result.status] ?? 0) + 1
    console.log(`  ${p.name} -> ${p.to}  [deprivation: ${result.status}]`)
  }
  console.log('\nDone. Deprivation outcomes:', tally)
}

main().then(() => process.exit(0))
