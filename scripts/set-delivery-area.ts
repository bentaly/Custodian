/**
 * Sets one application's delivery area and re-resolves its deprivation context.
 *
 *   pnpm tsx scripts/set-delivery-area.ts <appId|name substring> "<area>"
 *   pnpm tsx scripts/set-delivery-area.ts <appId|name substring> "<area>" --apply
 *
 * For correcting an area a foundation stated in a form the gazetteer cannot read
 * — a venue ("Broadhurst Park, Manchester"), or two places joined by "and".
 * `resolveDeprivation` geocodes the string as ONE settlement name, so those
 * resolve to nothing; the fix is to state the settlement actually meant.
 *
 * Deliberately does NOT re-score: the area feeds the Custodian score, but a
 * score that moves under a trustee mid-round is worse than one computed against
 * a slightly coarser area. Re-score explicitly if that is what you want.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { applications } from '../drizzle/schema'
import { resolveDeprivation } from '../src/server/deprivation/run'
import { deliveryGeoFromResult } from '../src/lib/deprivation/types'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

async function main() {
  const [target, area] = process.argv.slice(2)
  const apply = process.argv.includes('--apply')
  if (!target || !area || area.startsWith('--')) {
    throw new Error('usage: set-delivery-area.ts <appId|name substring> "<area>" [--apply]')
  }

  const all = await db
    .select({
      id: applications.id,
      name: applications.organisationName,
      deliveryArea: applications.deliveryArea,
      status: applications.deprivationStatus,
    })
    .from(applications)
  const matches = all.filter(
    (r) => r.id === target || r.name.toLowerCase().includes(target.toLowerCase()),
  )
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one application, got ${matches.length}: ` +
        matches.map((m) => m.name).join(', '),
    )
  }
  const app = matches[0]!

  console.log(`${app.name}`)
  console.log(`  ${JSON.stringify(app.deliveryArea)} [${app.status}]  ->  ${JSON.stringify(area)}`)

  const result = await resolveDeprivation(area)
  console.log(`  deprivation would be: ${result.status}`)
  if (result.status === 'resolved') {
    console.log(
      `    ${result.areaType} "${result.areaName}" · deciles ${result.min}\u2013${result.max} (median ${result.median}, ${result.count} areas) · ${result.vintage}`,
    )
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  const attempted = result.status !== 'pending'
  const geo = deliveryGeoFromResult(result)
  await db
    .update(applications)
    .set({
      deliveryArea: area,
      deprivationStatus: result.status,
      deprivationContext: attempted ? result : null,
      deprivationResolvedAt: attempted ? new Date() : null,
      deliveryNation: geo.nation,
      deliveryRegion: geo.region,
      deliveryLadCode: geo.ladCode,
      deliveryLadName: geo.ladName,
    })
    .where(eq(applications.id, app.id))
  console.log('\nWritten.')
}

main().then(() => process.exit(0))
