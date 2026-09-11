/**
 * Re-runs AI "Custodian score" assessment over existing applications and updates
 * the stored score/detail. Useful for backfilling rows created before scoring
 * existed, or re-scoring after the rubric/prompt changes.
 *
 *   pnpm tsx scripts/rerun-custodian-score.ts --client=Arete --dry-run
 *   pnpm tsx scripts/rerun-custodian-score.ts --client=Arete
 *   pnpm tsx scripts/rerun-custodian-score.ts --client=Arete --pending
 *   pnpm tsx scripts/rerun-custodian-score.ts --client=Arete --include-imported
 *   pnpm tsx scripts/rerun-custodian-score.ts <appId>
 *   pnpm tsx scripts/rerun-custodian-score.ts --all        # EVERY tenant
 *
 * Requires the same env as the app (DATABASE_URL + ANTHROPIC_API_KEY). Remember
 * that `.env`'s active DATABASE_URL is STAGING — which is where you want this.
 *
 * **`--client` or `--all` is required**, and `--all` has to be typed out. This
 * script is cross-tenant: it used to re-score every application on the platform
 * when run with no arguments, so the easiest thing to type spent model time on
 * every foundation's book to see one foundation's change. Same reasoning as
 * `digestWindow` requiring a clientId — there should be no all-tenants variant
 * you can reach for by accident.
 *
 * **IMPORTED applications are skipped, and `--pending` is a trap without that.**
 * An imported grant has no score for good (CLAUDE.md, "Onboarding data import"):
 * scoring a 2019 application against goals written in 2026 is a confident,
 * meaningless number. Imported rows carry no responses at all, so the model has
 * nothing to assess and returns a uniformly low score — 25-36 out of 100 across
 * Arete's eight, which on screen reads as eight charities who wrote terrible
 * applications rather than eight rows that predate us. Worse, a re-score
 * OVERWRITES `grant_purpose`, replacing the purpose the onboarding workbook
 * supplied with the model's account of an application nobody ever submitted.
 *
 * The trap: imported rows sit at `pending` precisely BECAUSE they are never
 * scored, so `--pending` on a client with history selects the imported rows and
 * almost nothing else — the one flag that sounds like a safe backfill is the one
 * that does the most damage. `--include-imported` exists for a deliberate
 * exception; there is no reason to reach for it.
 *
 * Three levels of commitment, and on PRODUCTION data you want them in this order:
 *
 *   --dry-run   lists what would be re-scored with each row's current score, and
 *               calls no model at all. Free. Run it first: the count it prints is
 *               what the real run will spend.
 *   --preview   scores for real and prints old → new, but writes NOTHING. Costs
 *               model time, mutates no row. This is how you see what a prompt
 *               change does to a live book before deciding to keep it — there is
 *               no score history table, so a real run cannot be undone.
 *   (neither)   scores and persists.
 *
 * Note: back-to-back runs reuse the cached scoring rubric (the system prompt is
 * marked cache_control: ephemeral), so a batch is cheaper per application than a
 * single row — provided the run stays inside the cache's 5-min TTL.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq, inArray, sql } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { runCustodianScore } from '../src/server/custodianScore/run'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

/**
 * Application ids belonging to one client, matched on the client's name
 * (case-insensitive, trimmed — the same comparison `findActiveRoundProgrammeByName`
 * makes, and for the same reason: a trailing space in a name is invisible on screen)
 * or on its uuid. Tenancy lives two joins away from an application, so this is a
 * separate query rather than a filter on the relational read below.
 */
async function applicationIdsForClient(client: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .innerJoin(
      schema.roundProgrammes,
      eq(schema.roundProgrammes.id, schema.applications.roundProgrammeId),
    )
    .innerJoin(schema.programmes, eq(schema.programmes.id, schema.roundProgrammes.programmeId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.programmes.clientId))
    .where(
      sql`lower(trim(${schema.clients.name})) = lower(trim(${client}))
          or ${schema.clients.id}::text = ${client}`,
    )
  return rows.map((r) => r.id)
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const has = (name: string) => args.includes(`--${name}`)

  const pendingOnly = has('pending')
  const dryRun = has('dry-run')
  const preview = has('preview')
  const client = flag('client')
  const singleId = args.find((a) => !a.startsWith('--'))

  if (!client && !singleId && !has('all')) {
    console.error(
      'Refusing to re-score every tenant by default.\n\n' +
        '  --client=<name|id>   one foundation\n' +
        '  <appId>              one application\n' +
        '  --all                every application on the platform\n\n' +
        'Add --dry-run to any of those to see what would run without calling a model.',
    )
    process.exit(1)
  }

  let ids: string[] | undefined
  if (client) {
    ids = await applicationIdsForClient(client)
    if (!ids.length) {
      // Naming the alternatives, because the likeliest cause is the foundation's name
      // on this environment differing from the one in your head — and the second
      // likeliest is being pointed at the wrong database.
      const all = await db
        .select({ name: schema.clients.name, id: schema.clients.id })
        .from(schema.clients)
      console.error(
        `No applications found for client "${client}".\n\nClients on this database:\n` +
          all.map((c) => `  ${c.name}  (${c.id})`).join('\n'),
      )
      process.exit(1)
    }
  }

  const rows = await db.query.applications.findMany({
    where: singleId
      ? (a, { eq }) => eq(a.id, singleId)
      : ids
        ? (a, { inArray: inA }) => inA(a.id, ids!)
        : undefined,
    columns: {
      id: true,
      organisationName: true,
      organisationSummary: true,
      amountRequested: true,
      unrestrictedReserves: true,
      budgetBreakdown: true,
      budgetBreakdownLink: true,
      deliveryArea: true,
      deprivationContext: true,
      proposedImpactQuantity: true,
      charityNumber: true,
      companyNumber: true,
      organisationProfile: true,
      responses: true,
      custodianScoreStatus: true,
      custodianScore: true,
      importBatchId: true,
    },
    with: {
      roundProgramme: { with: { programme: { with: { client: { with: { profile: true } } } } } },
    },
  })

  // Imported rows are excluded BEFORE `--pending` is applied, because that flag
  // would otherwise select them almost exclusively. See the header.
  const scorable = has('include-imported') ? rows : rows.filter((r) => !r.importBatchId)
  const skipped = rows.length - scorable.length
  if (skipped) {
    console.log(
      `Skipping ${skipped} imported application(s) — an imported grant has no score ` +
        `for good, and re-scoring one would overwrite the purpose the workbook supplied.\n`,
    )
  }
  const targets = pendingOnly
    ? scorable.filter((r) => r.custodianScoreStatus === 'pending')
    : scorable
  const was = (a: (typeof targets)[number]) =>
    a.custodianScore != null ? `${a.custodianScore}/100` : a.custodianScoreStatus

  if (dryRun) {
    console.log(`Would re-score ${targets.length} application(s) — no model calls made.\n`)
    for (const app of targets) {
      // What each row can actually feed the prompt, so a run against a book with no
      // register data or no resolved locations doesn't look like a broken prompt.
      const evidence = [
        app.organisationProfile ? 'register' : null,
        app.deprivationContext?.status === 'resolved' ? 'decile' : null,
        app.proposedImpactQuantity != null ? 'impact' : null,
      ].filter(Boolean)
      console.log(
        `  ${app.organisationName.slice(0, 38).padEnd(40)} ${was(app).padEnd(10)} ` +
          `${evidence.length ? evidence.join(' + ') : '— none of the new evidence'}`,
      )
    }
    const withProfile = targets.filter((a) => a.organisationProfile).length
    const withDecile = targets.filter((a) => a.deprivationContext?.status === 'resolved').length
    const withImpact = targets.filter((a) => a.proposedImpactQuantity != null).length
    console.log(
      `\n${withProfile}/${targets.length} carry register data, ` +
        `${withDecile} a resolved decile, ${withImpact} a proposed impact figure.`,
    )
    return
  }

  console.log(
    preview
      ? `PREVIEW — scoring ${targets.length} application(s), writing nothing.\n`
      : `Re-scoring ${targets.length} application(s)...\n`,
  )
  const moves: Array<{ name: string; from: number; to: number }> = []

  const failures: Array<{ id: string; name: string; reason: string }> = []

  for (const app of targets) {
    try {
      await scoreOne(app)
    } catch (e) {
      // One flaky call must not cost the other twenty. `runCustodianScore` never
      // throws, but the Neon write after it can (a dropped fetch on a long run), and
      // an uncaught one used to abandon the rest of the book mid-way — leaving a
      // foundation's scores half from one prompt and half from another, with the
      // script's own output the only record of where it stopped.
      const reason = e instanceof Error ? e.message : String(e)
      failures.push({ id: app.id, name: app.organisationName, reason })
      console.log(`  ${app.organisationName.slice(0, 38).padEnd(40)} FAILED — ${reason}`)
    }
  }

  async function scoreOne(app: (typeof targets)[number]) {
    const programme = app.roundProgramme.programme
    const result = await runCustodianScore({
      missionStatement: programme.client.profile?.missionStatement,
      programmeName: programme.name,
      programmeGoal: programme.goal,
      programmeDescription: programme.description,
      grantDurationYears: app.roundProgramme.grantDurationYears,
      organisationName: app.organisationName,
      organisationSummary: app.organisationSummary,
      amountRequested: Number(app.amountRequested),
      unrestrictedReserves:
        app.unrestrictedReserves != null ? Number(app.unrestrictedReserves) : null,
      budgetBreakdown: app.budgetBreakdown,
      budgetBreakdownLink: app.budgetBreakdownLink,
      deliveryArea: app.deliveryArea,
      deprivation: app.deprivationContext,
      proposedImpactQuantity:
        app.proposedImpactQuantity != null ? Number(app.proposedImpactQuantity) : null,
      impactUnit: programme.impactUnit,
      impactUnitLabel: programme.impactUnitLabel,
      organisationProfile: app.organisationProfile,
      charityNumber: app.charityNumber,
      companyNumber: app.companyNumber,
      responses: app.responses,
    })
    if (!preview) {
      await db
        .update(schema.applications)
        .set({
          custodianScoreStatus: result.status,
          custodianScore: result.score,
          custodianScoreDetail: result.detail,
          custodianScoredAt: new Date(result.scoredAt),
          // Kept only when the run produced one, so a failed re-score doesn't blank a
          // purpose that is already on the row.
          ...(result.grantPurpose ? { grantPurpose: result.grantPurpose } : {}),
        })
        .where(eq(schema.applications.id, app.id))
    }
    const headline = result.status === 'scored' ? `${result.score}/100` : result.status
    // Printed old → new, because the point of a re-score is the MOVEMENT: a column of
    // new numbers says nothing about whether the prompt change did anything.
    const delta =
      app.custodianScore != null && result.score != null
        ? ` (${result.score - app.custodianScore >= 0 ? '+' : ''}${result.score - app.custodianScore})`
        : ''
    if (app.custodianScore != null && result.score != null) {
      moves.push({ name: app.organisationName, from: app.custodianScore, to: result.score })
    }
    console.log(
      `  ${app.organisationName.slice(0, 38).padEnd(40)} ${was(app).padEnd(10)} → ${headline}${delta}`,
    )
  }

  if (moves.length) {
    const deltas = moves.map((m) => m.to - m.from)
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
    const biggest = [...moves].sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))[0]!
    console.log(
      `\n${moves.length} scored both times. Mean change ${mean >= 0 ? '+' : ''}${mean.toFixed(1)}, ` +
        `range ${Math.min(...deltas)} to ${Math.max(...deltas)}. ` +
        `Biggest mover: ${biggest.name} ${biggest.from} → ${biggest.to}.`,
    )
  }

  if (failures.length) {
    console.log(
      `\n${failures.length} FAILED and kept their previous score. Re-run for just these:\n` +
        failures.map((f) => `  npx tsx ${process.argv[1]} ${f.id}   # ${f.name}`).join('\n'),
    )
  }

  console.log(preview ? '\nPreview only — nothing was written.' : '\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
