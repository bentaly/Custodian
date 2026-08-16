// `pnpm demo:apply` — put every demo application through the REAL ingest pipeline.
//
// This is the step that costs money. Each submission runs field mapping, the Custodian
// score, due diligence against the live registers and the deprivation lookup, exactly
// as a real submission would. Nothing here is fabricated: the scores, DD outcomes and
// deprivation deciles are whatever the pipeline actually produces from the text.
//
// It calls `saveIngest` + `processIngest` directly rather than posting to /api/apply.
// The route adds API-key auth, a rate limiter and a `waitUntil` hand-off, none of which
// is what we are demonstrating — and calling in-process means the run is sequential,
// observable, and stoppable the moment something looks wrong.
//
// Flags:
//   --limit=N        stop after N submissions (use a small number first)
//   --only=<round>   only one round, by key (e.g. --only=summer26)
//   --live           force the real pipeline even when a snapshot exists
//
// REPLAY IS THE DEFAULT once `pnpm demo:snapshot` has recorded a live run. The
// applications are static, so the pipeline returns the same assessment every time —
// paying for it again in order to change a round date or an award status is waste.
// Replay inserts the recorded assessment directly and finishes in seconds. Use `--live`
// when the narratives have changed and the assessment genuinely needs to be redone.
//
// Payloads are keyed by CANONICAL field name, so the rule-based matcher resolves them
// on an exact-key match and the AI mapping fallback is never asked to guess a bank
// account number. Narrative answers use human question labels and land in `responses`,
// which is where a real foundation's form fields end up too.

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import { applicationIngests, applications, rounds } from '../../drizzle/schema'
import { saveIngest, processIngest } from '../../src/server/fieldMapping/ingest'
import { bankFields } from '../../src/server/applications/bank'
import { findActiveRoundProgrammeByName } from '../../src/server/applications/create'
import { parseBudgetBreakdown } from '../../src/lib/budget'
import { APPLICATIONS, HELD_SUBMISSION, type DemoApplication } from './lib/applications'
import {
  ORG_BY_KEY,
  PROGRAMMES,
  ROUNDS,
  contactEmail,
  type DemoOrg,
  type RoundKey,
} from './lib/data'
import { loadSnapshot, warnIfStale, type ApplicationSnapshot } from './lib/snapshot'
import { daysFromNow, requireDemoClient, runScript, step, done } from './lib/shared'

const args = process.argv.slice(2)
const limit = Number(args.find((a) => a.startsWith('--limit'))?.split('=')[1] ?? Infinity)
const only = args.find((a) => a.startsWith('--only'))?.split('=')[1] as RoundKey | undefined
const forceLive = args.includes('--live')

const PROGRAMME_BY_KEY = Object.fromEntries(PROGRAMMES.map((p) => [p.key, p]))

function buildPayload(app: DemoApplication, org: DemoOrg): Record<string, unknown> {
  const programme = PROGRAMME_BY_KEY[app.programme]!
  const omit = new Set(app.omit ?? [])

  const payload: Record<string, unknown> = {
    // ── canonical fields, by their canonical key ──
    programmeName: programme.name,
    externalApplicationId: app.ref,
    organisationName: org.name,
    applicantEmail: contactEmail(org),
    amountRequested: app.amount,
    bankName: org.bankName,
    bankAccountName: org.name,
    bankAccountNumber: org.accountNumber,
    bankSortCode: org.sortCode,
  }
  if (org.charityNumber) payload.charityNumber = org.charityNumber
  if (org.companyNumber) payload.companyNumber = org.companyNumber
  if (!omit.has('deliveryArea')) payload.deliveryArea = org.area
  if (!omit.has('impact') && app.impact != null) payload.proposedImpactQuantity = app.impact
  if (!omit.has('budget')) {
    if (app.budget) payload.budgetBreakdown = app.budget
    if (app.budgetLink) payload.budgetBreakdownLink = app.budgetLink
  }

  // ── the foundation's own questions → `responses` ──
  payload['Project title'] = app.project
  payload['What need does this address?'] = app.need
  payload['How will you deliver the work?'] = app.approach
  payload['What evidence do you have that this works?'] = app.evidence
  payload['How will the work continue after this grant?'] = app.sustainability
  if (app.partners) payload['Who else is involved?'] = app.partners

  return payload
}

/**
 * Insert an application from the recorded pipeline output, skipping the model and
 * register calls entirely.
 *
 * The canonical fields are rebuilt from the same payload the live path sends, so the
 * application is identical in every respect except that its assessment is replayed
 * rather than recomputed. The ingest row is written alongside it, `complete`, so the
 * admin queue and the tenancy scope look exactly as they would after a live run.
 */
async function replay(
  app: DemoApplication,
  org: DemoOrg,
  payload: Record<string, unknown>,
  snap: ApplicationSnapshot,
  clientId: string,
) {
  const programme = PROGRAMME_BY_KEY[app.programme]!
  const rp = await findActiveRoundProgrammeByName(clientId, programme.name)
  if (!rp) return { ingestId: null, applicationId: null, status: 'error' as const }

  // Everything the payload carries that is NOT a canonical field is a form response,
  // exactly as `computeResponses` derives it on the live path.
  const canonicalKeys = new Set([
    'programmeName',
    'externalApplicationId',
    'organisationName',
    'applicantEmail',
    'amountRequested',
    'bankName',
    'bankAccountName',
    'bankAccountNumber',
    'bankSortCode',
    'charityNumber',
    'companyNumber',
    'deliveryArea',
    'budgetBreakdown',
    'budgetBreakdownLink',
    'proposedImpactQuantity',
  ])
  const responses = Object.entries(payload)
    .filter(([k]) => !canonicalKeys.has(k))
    .map(([label, value]) => ({ label, value: String(value) }))
    .filter((r) => r.value)

  const id = crypto.randomUUID()
  const db = getDb()
  await db.insert(applications).values({
    id,
    roundProgrammeId: rp.id,
    externalApplicationId: app.ref,
    organisationName: org.name,
    applicantEmail: contactEmail(org),
    charityNumber: org.charityNumber,
    companyNumber: org.companyNumber,
    deliveryArea: (payload.deliveryArea as string | undefined) ?? null,
    bankName: org.bankName,
    bankAccountName: org.name,
    ...bankFields({ bankSortCode: org.sortCode, bankAccountNumber: org.accountNumber }),
    amountRequested: String(app.amount),
    proposedImpactQuantity:
      payload.proposedImpactQuantity != null ? String(payload.proposedImpactQuantity) : null,
    budgetBreakdown: payload.budgetBreakdown
      ? parseBudgetBreakdown(JSON.stringify(payload.budgetBreakdown))
      : null,
    budgetBreakdownLink: (payload.budgetBreakdownLink as string | undefined) ?? null,
    responses,
    // ── the recorded assessment ──
    dueDiligenceStatus: snap.dueDiligenceStatus as 'clear',
    dueDiligenceChecks: snap.dueDiligenceChecks as never,
    dueDiligenceCheckedAt: snap.dueDiligenceCheckedAt ? new Date(snap.dueDiligenceCheckedAt) : null,
    custodianScoreStatus: snap.custodianScoreStatus as 'scored',
    custodianScore: snap.custodianScore,
    custodianScoreDetail: snap.custodianScoreDetail as never,
    custodianScoredAt: snap.custodianScoredAt ? new Date(snap.custodianScoredAt) : null,
    grantPurpose: snap.grantPurpose,
    deprivationStatus: snap.deprivationStatus as 'resolved',
    deprivationContext: snap.deprivationContext as never,
    deprivationResolvedAt: snap.deprivationResolvedAt ? new Date(snap.deprivationResolvedAt) : null,
    deliveryNation: snap.deliveryNation as 'england' | null,
    deliveryRegion: snap.deliveryRegion,
    deliveryLadCode: snap.deliveryLadCode,
    deliveryLadName: snap.deliveryLadName,
  })

  const [ingest] = await db
    .insert(applicationIngests)
    .values({
      clientId,
      roundProgrammeId: rp.id,
      applicationId: id,
      rawPayload: payload,
      status: 'complete',
      resolved: Object.fromEntries(
        Object.keys(payload)
          .filter((k) => canonicalKeys.has(k))
          .map((k) => [k, k]),
      ),
      resolvedAt: new Date(),
    })
    .returning({ id: applicationIngests.id })

  return { ingestId: ingest!.id, applicationId: id, status: 'complete' as const }
}

/** Submit one payload through the pipeline and report what the pipeline made of it. */
async function submit(label: string, payload: Record<string, unknown>, clientId: string) {
  const ingestId = await saveIngest({ clientId, payload })
  const result = await processIngest(ingestId)
  if (!result.ok) {
    console.log(`  ✗ ${label} — pipeline error: ${result.error}`)
    return { ingestId, applicationId: null as string | null, status: 'error' }
  }
  return { ingestId, applicationId: result.applicationId, status: result.status }
}

/** Applications land with `submittedAt = now()`; the fixture's dates are what make the
 *  past round look like a past round. The ingest row is moved with it so the admin
 *  queue's chronology matches the application's. */
async function backdate(applicationId: string, ingestId: string | null, daysAgo: number) {
  const when = daysFromNow(-daysAgo)
  await getDb()
    .update(applications)
    .set({ submittedAt: when, createdAt: when })
    .where(eq(applications.id, applicationId))
  if (!ingestId) return
  await getDb()
    .update(applicationIngests)
    .set({ createdAt: when, resolvedAt: when })
    .where(eq(applicationIngests.id, ingestId))
}

/** Only ONE round may be open while a phase submits: `findActiveRoundProgrammeByName`
 *  picks the most recently opened active round for a programme name, and every
 *  programme appears in both rounds. */
async function openOnly(clientId: string, roundName: string) {
  const db = getDb()
  for (const r of ROUNDS) {
    const isTarget = r.name === roundName
    await db
      .update(rounds)
      .set(
        isTarget
          ? { openedAt: daysFromNow(-r.openedDaysAgo), closedAt: null }
          : // Parked in the future so it is not "active" for the matcher.
            { openedAt: daysFromNow(365), closedAt: null },
      )
      .where(sql`${rounds.clientId} = ${clientId} and ${rounds.name} = ${r.name}`)
  }
}

/** Put both rounds back to the dates the dataset is supposed to have. */
async function restoreRoundDates(clientId: string) {
  const db = getDb()
  for (const r of ROUNDS) {
    await db
      .update(rounds)
      .set({
        openedAt: daysFromNow(-r.openedDaysAgo),
        closedAt: r.closedDaysAgo === null ? null : daysFromNow(-r.closedDaysAgo),
      })
      .where(sql`${rounds.clientId} = ${clientId} and ${rounds.name} = ${r.name}`)
  }
}

/** References already submitted for this tenant. This step costs real money and takes
 *  the better part of an hour, so it must be resumable: a failure at number 35 should
 *  not mean paying for the first 34 again. */
async function alreadySubmitted(clientId: string): Promise<Set<string>> {
  const rows = await getDb().execute(sql`
    select i.raw_payload->>'externalApplicationId' as ref
    from application_ingests i
    where i.client_id = ${clientId}
  `)
  return new Set(
    (rows.rows as Array<{ ref: string | null }>).map((r) => r.ref).filter(Boolean) as string[],
  )
}

runScript('demo:apply', async () => {
  const client = await requireDemoClient()
  const clientId = client.id

  const done_ = await alreadySubmitted(clientId)
  if (done_.size > 0) {
    console.log(`  resuming — ${done_.size} already submitted, skipping those`)
  }

  // Replay unless told otherwise — see the header. A snapshot missing an entry for a
  // given reference falls through to the live pipeline for that one application, so
  // adding a new application to the fixture does not force a full re-run.
  const snapshot = forceLive ? null : loadSnapshot()
  if (snapshot) {
    warnIfStale(snapshot)
    console.log(
      `  replaying the pipeline snapshot captured ${snapshot.capturedAt.slice(0, 10)}` +
        ' — no model or register calls, no cost.\n' +
        '  Pass --live to run the real pipeline instead.',
    )
  } else if (forceLive) {
    console.log('  --live: running the real pipeline (this costs money)')
  } else {
    console.log('  no snapshot found — running the real pipeline (this costs money)')
  }

  const counts = { complete: 0, ai_proposed: 0, needs_review: 0, error: 0 }
  let submitted = 0
  let skipped = 0

  try {
    for (const round of ROUNDS) {
      if (only && round.key !== only) continue

      const batch = APPLICATIONS.filter((a) => a.round === round.key)
      if (!batch.length) continue

      step(`${round.name} — ${batch.length} applications`)
      // The past round has to be open while its own applications are submitted; it is
      // closed again by restoreRoundDates() once the phase is done.
      await openOnly(clientId, round.name)

      for (const app of batch) {
        if (submitted >= limit) break
        if (done_.has(app.ref)) {
          skipped++
          continue
        }
        const org = ORG_BY_KEY[app.org]!
        const t0 = Date.now()
        const payload = buildPayload(app, org)
        const snap = snapshot?.applications[app.ref]
        const { ingestId, applicationId, status } = snap
          ? await replay(app, org, payload, snap, clientId)
          : await submit(app.ref, payload, clientId)
        submitted++
        counts[status as keyof typeof counts] = (counts[status as keyof typeof counts] ?? 0) + 1

        if (applicationId) {
          await backdate(applicationId, ingestId, app.submittedDaysAgo)
          const row = await getDb().query.applications.findFirst({
            where: eq(applications.id, applicationId),
            columns: {
              custodianScore: true,
              custodianScoreStatus: true,
              dueDiligenceStatus: true,
              deprivationStatus: true,
            },
          })
          done(
            `${app.ref} ${org.name} — score ${row?.custodianScore ?? row?.custodianScoreStatus}` +
              ` · DD ${row?.dueDiligenceStatus} · deprivation ${row?.deprivationStatus}` +
              ` · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
          )
        } else {
          done(`${app.ref} ${org.name} — held (${status})`)
        }
      }
      if (submitted >= limit) break
    }

    // The deliberately-held submission: it names a programme the foundation does not
    // run, so no round programme resolves and it waits in the admin review queue.
    if (submitted < limit && !only && !done_.has(HELD_SUBMISSION.ref)) {
      step('One submission for the admin review queue')
      const org = ORG_BY_KEY[HELD_SUBMISSION.org]!
      const { status } = await submit(
        HELD_SUBMISSION.ref,
        {
          programmeName: HELD_SUBMISSION.programmeName,
          externalApplicationId: HELD_SUBMISSION.ref,
          organisationName: org.name,
          applicantEmail: contactEmail(org),
          amountRequested: HELD_SUBMISSION.amount,
          companyNumber: org.companyNumber,
          bankName: org.bankName,
          bankAccountName: org.name,
          bankAccountNumber: org.accountNumber,
          bankSortCode: org.sortCode,
          deliveryArea: org.area,
          'Project title': HELD_SUBMISSION.project,
        },
        clientId,
      )
      done(
        `${HELD_SUBMISSION.ref} — ${status} (programme "${HELD_SUBMISSION.programmeName}" is unknown)`,
      )
    }
  } finally {
    // Always restore, even if a submission threw — leaving the past round open would
    // send the next run's applications into the wrong round.
    await restoreRoundDates(clientId)
    done('round dates restored')
  }

  step('Summary')
  console.log(`  submitted:     ${submitted}`)
  console.log(`  skipped:       ${skipped} (already present)`)
  console.log(`  promoted:      ${counts.complete}`)
  console.log(`  ai-proposed:   ${counts.ai_proposed}`)
  console.log(`  held:          ${counts.needs_review}`)
  console.log(`  errors:        ${counts.error}`)
})
