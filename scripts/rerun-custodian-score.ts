/**
 * Re-runs AI "Custodian score" assessment over existing applications and updates
 * the stored score/detail. Useful for backfilling rows created before scoring
 * existed, or re-scoring after the rubric/prompt changes.
 *
 *   pnpm tsx scripts/rerun-custodian-score.ts            # all applications
 *   pnpm tsx scripts/rerun-custodian-score.ts --pending  # only un-scored rows
 *   pnpm tsx scripts/rerun-custodian-score.ts <appId>    # a single application
 *
 * Requires the same env as the app (DATABASE_URL + ANTHROPIC_API_KEY).
 *
 * Note: back-to-back runs reuse the cached scoring rubric (the system prompt is
 * marked cache_control: ephemeral), so the backfill is cheaper than the per-call
 * price would suggest — provided the run completes within the cache's 5-min TTL.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { runCustodianScore } from '../src/server/custodianScore/run'

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
      amountRequested: true,
      deliveryArea: true,
      charityNumber: true,
      companyNumber: true,
      responses: true,
      custodianScoreStatus: true,
    },
    with: {
      roundProgramme: { with: { programme: { with: { client: { with: { profile: true } } } } } },
    },
  })

  const targets = pendingOnly
    ? rows.filter((r) => r.custodianScoreStatus === 'pending')
    : rows
  console.log(`Re-scoring ${targets.length} application(s)...\n`)

  for (const app of targets) {
    const programme = app.roundProgramme.programme
    const result = await runCustodianScore({
      missionStatement: programme.client.profile?.missionStatement,
      programmeName: programme.name,
      programmeGoal: programme.goal,
      programmeDescription: programme.description,
      organisationName: app.organisationName,
      amountRequested: Number(app.amountRequested),
      deliveryArea: app.deliveryArea,
      charityNumber: app.charityNumber,
      companyNumber: app.companyNumber,
      responses: app.responses,
    })
    await db
      .update(schema.applications)
      .set({
        custodianScoreStatus: result.status,
        custodianScore: result.score,
        custodianScoreDetail: result.detail,
        custodianScoredAt: new Date(result.scoredAt),
      })
      .where(eq(schema.applications.id, app.id))
    const headline = result.status === 'scored' ? `${result.score}/100` : result.status
    console.log(`  ${app.organisationName.padEnd(40)} → ${headline}`)
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
