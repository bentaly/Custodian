/**
 * Re-runs due diligence screening over existing applications and updates the
 * stored status/checks. Useful for backfilling rows created before screening
 * existed, or after the check logic changes.
 *
 *   pnpm tsx scripts/rerun-due-diligence.ts            # all applications
 *   pnpm tsx scripts/rerun-due-diligence.ts --pending  # only un-screened rows
 *   pnpm tsx scripts/rerun-due-diligence.ts <appId>    # a single application
 *   pnpm tsx scripts/rerun-due-diligence.ts --missing-profile   # rows with no profile
 *
 * `--missing-profile` is the backfill for rows screened BEFORE
 * `applications.organisation_profile` existed (migration 0070, 30 Aug 2026).
 * Those rows have checks but no profile, so the application screen says "Not
 * read yet — re-run the register checks below to fetch it" and a human has to
 * press the button. The profile comes from the same register calls as the
 * checks, so this re-screens and writes both; statuses can legitimately move.
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
  const missingProfileOnly = arg === '--missing-profile'
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
      organisationProfile: true,
    },
  })

  const targets = pendingOnly
    ? rows.filter((r) => r.dueDiligenceStatus === 'pending')
    : missingProfileOnly
      ? // Only rows there is a register to read: a company-only applicant has no
        // profile to fetch, and one with no number at all has nothing to screen.
        rows.filter((r) => r.organisationProfile == null && r.charityNumber)
      : rows
  console.log(`Re-running due diligence over ${targets.length} application(s)...\n`)

  for (const app of targets) {
    const result = await runDueDiligence({
      charityNumber: app.charityNumber,
      companyNumber: app.companyNumber,
      organisationName: app.organisationName,
      amountRequested: Number(app.amountRequested),
    })
    await db
      .update(schema.applications)
      .set({
        dueDiligenceStatus: result.status,
        dueDiligenceChecks: result.checks,
        dueDiligenceCheckedAt: new Date(result.checkedAt),
        organisationProfile: result.profile,
      })
      .where(eq(schema.applications.id, app.id))
    const moved = result.status === app.dueDiligenceStatus ? '' : ` (was ${app.dueDiligenceStatus})`
    console.log(
      `  ${app.organisationName.padEnd(45)} → ${result.status}${moved}` +
        ` · ${result.checks.length} checks · profile ${result.profile ? 'fetched' : 'STILL EMPTY'}`,
    )
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
