/**
 * Re-runs due diligence screening over existing applications and updates the
 * stored status/checks. Useful for backfilling rows created before screening
 * existed, or after the check logic changes.
 *
 *   pnpm tsx scripts/rerun-due-diligence.ts            # all applications
 *   pnpm tsx scripts/rerun-due-diligence.ts --pending  # only un-screened rows
 *   pnpm tsx scripts/rerun-due-diligence.ts <appId>    # a single application
 *
 * Requires the same env as the app (DATABASE_URL + the register API keys).
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { runDueDiligence } from '../src/server/dueDiligence/run'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

async function main() {
  const arg = process.argv[2]
  const pendingOnly = arg === '--pending'
  const singleId = arg && !arg.startsWith('--') ? arg : undefined

  const rows = await db.query.applications.findMany({
    where: singleId ? (a, { eq }) => eq(a.id, singleId) : undefined,
    columns: {
      id: true,
      organisationName: true,
      charityNumber: true,
      companyNumber: true,
      amountRequested: true,
      dueDiligenceStatus: true,
    },
  })

  const targets = pendingOnly ? rows.filter((r) => r.dueDiligenceStatus === 'pending') : rows
  console.log(`Re-running due diligence over ${targets.length} application(s)...\n`)

  for (const app of targets) {
    const result = await runDueDiligence({
      charityNumber: app.charityNumber,
      companyNumber: app.companyNumber,
      amountRequested: Number(app.amountRequested),
    })
    await db
      .update(schema.applications)
      .set({
        dueDiligenceStatus: result.status,
        dueDiligenceChecks: result.checks,
        dueDiligenceCheckedAt: new Date(result.checkedAt),
      })
      .where(eq(schema.applications.id, app.id))
    console.log(`  ${app.organisationName.padEnd(40)} → ${result.status} (${result.checks.length} checks)`)
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
