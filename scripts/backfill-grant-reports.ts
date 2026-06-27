/**
 * Backfills the new `grant_reports` table from the legacy reporting milestones that lived
 * directly on `applications.reporting_schedule` (jsonb).
 *
 * Run once after the grant-reports migration is applied, and after backfill-grants.ts has
 * created the grant rows, before the legacy column is dropped in a later push:
 *
 *   pnpm tsx scripts/backfill-grant-reports.ts
 *
 * Idempotent: skips any grant that already has report rows, so it is safe to re-run.
 * Requires the same env as the app (DATABASE_URL → currently staging).
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { applications, grants, grantReports } from '../drizzle/schema'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

type LegacyMilestone = { label: string; date: string }

async function main() {
  // Grants joined to the legacy reporting schedule on their source application.
  const rows = await db
    .select({
      grantId: grants.id,
      reportingSchedule: applications.reportingSchedule,
    })
    .from(grants)
    .innerJoin(applications, eq(grants.applicationId, applications.id))

  if (rows.length === 0) {
    console.log('No application-derived grants found — nothing to backfill.')
    return
  }

  // Which grants already have report rows? Skip them.
  const existing = await db
    .select({ grantId: grantReports.grantId })
    .from(grantReports)
    .where(inArray(grantReports.grantId, rows.map((r) => r.grantId)))
  const haveReports = new Set(existing.map((e) => e.grantId))

  let grantsTouched = 0
  let reportsCreated = 0
  let skipped = 0

  for (const r of rows) {
    if (haveReports.has(r.grantId)) {
      skipped++
      continue
    }
    const milestones = (r.reportingSchedule as LegacyMilestone[] | null) ?? []
    if (milestones.length === 0) continue

    await db.insert(grantReports).values(
      milestones.map((m) => ({
        grantId: r.grantId,
        label: m.label,
        dueDate: m.date,
      })),
    )
    grantsTouched++
    reportsCreated += milestones.length
  }

  console.log(
    `Backfill complete: ${reportsCreated} report(s) created across ${grantsTouched} grant(s), ${skipped} skipped.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
