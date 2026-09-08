/**
 * Screens existing applications against the registers and stores the verdict.
 * Backfills rows created before the feature existed, or before the onboarding import
 * started screening what it writes.
 *
 *   pnpm tsx scripts/rerun-due-diligence.ts            # all applications
 *   pnpm tsx scripts/rerun-due-diligence.ts --pending  # only un-screened rows
 *   pnpm tsx scripts/rerun-due-diligence.ts <appId>    # a single application
 *
 * Requires the same env as the app: DATABASE_URL, plus CHARITY_COMMISSION_KEY /
 * COMPANIES_HOUSE_KEY / OSCR_API_KEY for the registers an application actually routes
 * to. Never throws per-row — an unreachable register comes back as a check result, the
 * same as it does inside the app.
 *
 * `--pending` is the recovery mode, and `pending` is the only status it means: an
 * application with no number to screen resolves to `no_registration`, which is a
 * verdict rather than a gap, and re-running it would only read the same NULL columns
 * again. `rerunDueDiligence` — which can SUPPLY the missing numbers — is the way out of
 * that one, and it is reachable from the admin app per application.
 *
 * The twin of `rerun-deprivation.ts`, deliberately down to the argument names: these
 * are the two derivations an import queues, so the two backfills should be one thing to
 * learn rather than two.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { applications } from '../drizzle/schema'
import { runDueDiligence } from '../src/server/dueDiligence/run'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

async function main() {
  const arg = process.argv[2]
  const pendingOnly = arg === '--pending'
  const singleId = arg && !arg.startsWith('--') ? arg : null

  const rows = await db
    .select({
      id: applications.id,
      organisationName: applications.organisationName,
      charityNumber: applications.charityNumber,
      companyNumber: applications.companyNumber,
      amountRequested: applications.amountRequested,
      status: applications.dueDiligenceStatus,
    })
    .from(applications)

  const todo = rows.filter((r) =>
    singleId ? r.id === singleId : pendingOnly ? r.status === 'pending' : true,
  )
  console.log(`Screening ${todo.length} application(s)…`)

  const tally: Record<string, number> = {}
  for (const r of todo) {
    const result = await runDueDiligence({
      charityNumber: r.charityNumber,
      companyNumber: r.companyNumber,
      organisationName: r.organisationName,
      amountRequested: Number(r.amountRequested),
    })
    await db
      .update(applications)
      .set({
        dueDiligenceStatus: result.status,
        dueDiligenceChecks: result.checks,
        dueDiligenceCheckedAt: new Date(result.checkedAt),
        organisationProfile: result.profile,
      })
      .where(eq(applications.id, r.id))
    console.log(`  ${r.organisationName} → ${result.status}`)
    tally[result.status] = (tally[result.status] ?? 0) + 1
  }
  console.log('Done:', tally)
}

main().then(() => process.exit(0))
