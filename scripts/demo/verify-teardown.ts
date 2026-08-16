// Throwaway check: prove `teardownDemo` can actually remove a FULLY populated tenant.
//
// The dataset's central promise is that it is disposable, and the thing that could
// break that is the three RESTRICT foreign keys (`awards.application_id`,
// `applications.round_programme_id`, `application_ingests.round_programme_id`): a
// wrong delete order aborts partway and leaves a tenant that cannot be removed OR
// re-seeded.
//
// Testing that against the real demo tenant would destroy data that cost real money,
// so this builds a THROWAWAY tenant containing one row in every table teardown touches
// — including the full application → award → report chain — and tears that down.
//
// Run: npx tsx scripts/demo/verify-teardown.ts

import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import {
  apiKeys,
  applicationComments,
  applicationIngests,
  applicationVotes,
  applications,
  auditLog,
  awardInstalments,
  awardLetters,
  awards,
  clientProfiles,
  clients,
  fieldMappings,
  importBatches,
  invitations,
  programmes,
  reportIngests,
  reportSchedule,
  reports,
  roundProgrammes,
  rounds,
  users,
} from '../../drizzle/schema'
import { teardownDemo } from './lib/teardown'
import { assertWritableDatabase } from './lib/shared'

const NAME = `__teardown-probe-${randomUUID().slice(0, 8)}`

async function main() {
  assertWritableDatabase()
  const db = getDb()

  console.log(`\nBuilding a throwaway tenant "${NAME}"`)
  const [client] = await db.insert(clients).values({ name: NAME }).returning({ id: clients.id })
  const clientId = client!.id

  await db.insert(clientProfiles).values({ clientId })
  await db.insert(fieldMappings).values({
    clientId,
    sourceKey: 'Probe field',
    canonicalField: 'organisationName',
    formType: 'application',
  })
  await db.insert(apiKeys).values({
    clientId,
    name: 'probe',
    keyHash: randomUUID(),
    last4: 'aaaa',
  })
  await db.insert(invitations).values({
    clientId,
    email: `probe-${randomUUID().slice(0, 6)}@wrenfield.example`,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  const [batch] = await db
    .insert(importBatches)
    .values({ clientId })
    .returning({ id: importBatches.id })

  const userId = randomUUID()
  await db.insert(users).values({
    id: userId,
    clientId,
    name: 'Probe User',
    email: `probe-${randomUUID().slice(0, 6)}@wrenfield.example`,
    updatedAt: new Date(),
  })

  const [round] = await db
    .insert(rounds)
    .values({ clientId, name: 'Probe round', openedAt: new Date() })
    .returning({ id: rounds.id })
  const [programme] = await db
    .insert(programmes)
    .values({ clientId, name: 'Probe programme' })
    .returning({ id: programmes.id })
  const [rp] = await db
    .insert(roundProgrammes)
    .values({ roundId: round!.id, programmeId: programme!.id, budget: '1000' })
    .returning({ id: roundProgrammes.id })

  const [app] = await db
    .insert(applications)
    .values({
      roundProgrammeId: rp!.id,
      organisationName: 'Probe Org',
      amountRequested: '500',
      importBatchId: batch!.id,
    })
    .returning({ id: applications.id })

  // The three RESTRICT paths, all present at once.
  await db.insert(applicationIngests).values({
    clientId,
    roundProgrammeId: rp!.id,
    applicationId: app!.id,
    rawPayload: {},
    status: 'complete',
  })
  await db.insert(applicationComments).values({ applicationId: app!.id, userId, body: 'probe' })
  await db.insert(applicationVotes).values({ applicationId: app!.id, userId, vote: 'yes' })
  await db.insert(auditLog).values({
    clientId,
    actorUserId: userId,
    action: 'application_shortlisted',
    applicationId: app!.id,
  })

  const [award] = await db
    .insert(awards)
    .values({ applicationId: app!.id, clientId, amountAwarded: '500', importBatchId: batch!.id })
    .returning({ id: awards.id })
  await db.insert(awardInstalments).values({ awardId: award!.id, instalmentNo: 1, amount: '500' })
  const [sched] = await db
    .insert(reportSchedule)
    .values({ awardId: award!.id, label: 'Probe report', dueDate: '2026-01-01' })
    .returning({ id: reportSchedule.id })
  await db.insert(awardLetters).values({
    awardId: award!.id,
    clientId,
    subject: 'probe',
    bodyText: 'probe',
    bodyHtml: '<p>probe</p>',
    conditions: [],
  })
  const [report] = await db
    .insert(reports)
    .values({
      clientId,
      awardId: award!.id,
      scheduleId: sched!.id,
      matchMethod: 'external_id',
      organisationName: 'Probe Org',
      impactSummary: 'probe',
      importBatchId: batch!.id,
    })
    .returning({ id: reports.id })
  await db.insert(reportIngests).values({
    clientId,
    rawPayload: {},
    status: 'complete',
    reportId: report!.id,
  })
  console.log('  ✓ populated every table teardown touches')

  console.log('\nTearing it down')
  await teardownDemo(clientId)

  // Prove nothing survived, table by table.
  const leftovers: string[] = []
  const check = async (label: string, q: ReturnType<typeof sql>) => {
    const n = ((await db.execute(q)).rows as Array<{ n: number }>)[0]?.n ?? 0
    if (Number(n) > 0) leftovers.push(`${label}: ${n}`)
  }
  await check('clients', sql`select count(*)::int n from clients where id = ${clientId}`)
  await check('rounds', sql`select count(*)::int n from rounds where client_id = ${clientId}`)
  await check(
    'programmes',
    sql`select count(*)::int n from programmes where client_id = ${clientId}`,
  )
  await check('applications', sql`select count(*)::int n from applications where id = ${app!.id}`)
  await check('awards', sql`select count(*)::int n from awards where client_id = ${clientId}`)
  await check('reports', sql`select count(*)::int n from reports where client_id = ${clientId}`)
  await check(
    'report_ingests',
    sql`select count(*)::int n from report_ingests where client_id = ${clientId}`,
  )
  await check(
    'application_ingests',
    sql`select count(*)::int n from application_ingests where client_id = ${clientId}`,
  )
  await check('users', sql`select count(*)::int n from users where id = ${userId}`)
  await check(
    'import_batches',
    sql`select count(*)::int n from import_batches where client_id = ${clientId}`,
  )
  await check('api_keys', sql`select count(*)::int n from api_keys where client_id = ${clientId}`)
  await check(
    'invitations',
    sql`select count(*)::int n from invitations where client_id = ${clientId}`,
  )

  if (leftovers.length) {
    console.error(`\n✗ TEARDOWN INCOMPLETE — rows survived:\n   ${leftovers.join('\n   ')}`)
    process.exit(1)
  }
  console.log('\n✓ teardown removed a fully-populated tenant cleanly')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n✗ FAILED — the throwaway tenant may need manual cleanup:', NAME)
    console.error(e)
    process.exit(1)
  })
