/**
 * Resolves deprivation context for existing applications and stores the result.
 * Backfills rows created before the feature existed, or after the resolver changes.
 *
 *   pnpm tsx scripts/rerun-deprivation.ts            # all applications
 *   pnpm tsx scripts/rerun-deprivation.ts --pending  # only un-resolved rows
 *   pnpm tsx scripts/rerun-deprivation.ts <appId>    # a single application
 *
 * Requires the same env as the app (DATABASE_URL). Hits postcodes.io / Nominatim and
 * the deprivation_areas table; never throws per-row (failures store as unresolvable).
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
  const arg = process.argv[2]
  const pendingOnly = arg === '--pending'
  const singleId = arg && !arg.startsWith('--') ? arg : null

  const rows = await db
    .select({ id: applications.id, deliveryArea: applications.deliveryArea, status: applications.deprivationStatus })
    .from(applications)

  const todo = rows.filter((r) =>
    singleId ? r.id === singleId : pendingOnly ? r.status === 'pending' : true,
  )
  console.log(`Resolving ${todo.length} application(s)…`)

  const tally: Record<string, number> = {}
  for (const r of todo) {
    const result = await resolveDeprivation(r.deliveryArea)
    const attempted = result.status !== 'pending'
    const geo = deliveryGeoFromResult(result)
    await db
      .update(applications)
      .set({
        deprivationStatus: result.status,
        deprivationContext: attempted ? result : null,
        deprivationResolvedAt: attempted ? new Date() : null,
        deliveryNation: geo.nation,
        deliveryRegion: geo.region,
        deliveryLadCode: geo.ladCode,
        deliveryLadName: geo.ladName,
      })
      .where(eq(applications.id, r.id))
    tally[result.status] = (tally[result.status] ?? 0) + 1
  }
  console.log('Done:', tally)
}

main().then(() => process.exit(0))
