// ─── Custodian score, as its own step ────────────────────────────────────────
//
// Scoring used to happen inside `createApplicationFromCanonical`, which meant a
// submission's application did not exist until the model had finished — 30-60
// seconds of it. On the public `/api/apply` path that work ran after the response
// had already gone out, inside the invocation's 30-second `waitUntil` budget, and
// on 24 Aug 2026 it ran out: Cloudflare cancelled the invocation mid-call (the
// model's own log records the disconnect at 26.8s), the promise was ABANDONED
// rather than rejected, so nothing threw, nothing was logged, and the ingest row
// sat at `received` until a human pressed Reprocess eight hours later.
//
// So the score is now asked for separately. `createApplicationFromCanonical` with
// `score: 'queued'` writes the application immediately with
// `custodianScoreStatus: 'queued'`, and this module is what turns that into a
// score. It is deliberately re-runnable and self-guarding, because whatever calls
// it (a queue with retries, a human pressing a button) may call it more than once.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applications } from '../../../drizzle/schema'
import { runCustodianScore } from '../custodianScore/run'
import type { CustodianScoreStatus } from '../../lib/custodianScore/types'
import { fetchRoundProgrammeForApplication } from './create'

export type ScoreApplicationResult =
  | { ok: false; reason: 'not_found' | 'round_programme_missing' }
  | { ok: false; reason: 'not_queued'; status: string }
  // Whatever the runner returned. `queued` is in the union but the runner never
  // produces it — by the time it has an answer the waiting is over — so in practice
  // this is scored / pending / error.
  | { ok: true; status: CustodianScoreStatus; score: number | null }

/**
 * Produce and store the Custodian score for one application.
 *
 * Only acts on a row still at `queued` unless `force` is set. That guard is what
 * makes this safe to call twice: a queue that retries after the write landed but
 * before the ack finds the row already `scored` and does nothing, rather than
 * spending another 30-60s of model time and overwriting a good score with a
 * second opinion.
 *
 * `force` is for the deliberate re-score of a row that is already `scored` or in
 * `error` — the same reasoning as `rerunDueDiligence`, where being able to correct
 * a bad answer is the point.
 */
export async function scoreApplication(
  applicationId: string,
  opts: { force?: boolean } = {},
): Promise<ScoreApplicationResult> {
  const db = getDb()
  const application = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
  })
  if (!application) return { ok: false, reason: 'not_found' }
  if (application.custodianScoreStatus !== 'queued' && !opts.force) {
    return {
      ok: false,
      reason: 'not_queued',
      status: application.custodianScoreStatus ?? 'pending',
    }
  }

  const roundProgramme = await fetchRoundProgrammeForApplication(application.roundProgrammeId)
  if (!roundProgramme) return { ok: false, reason: 'round_programme_missing' }
  const programme = roundProgramme.programme

  // Never throws — a model failure comes back as `error`, which is re-runnable and
  // visible, rather than as an exception that would send a queue into retry over
  // something retrying will not fix.
  const custodian = await runCustodianScore({
    missionStatement: programme.client.profile?.missionStatement,
    programmeName: programme.name,
    programmeGoal: programme.goal,
    programmeDescription: programme.description,
    organisationName: application.organisationName,
    amountRequested: Number(application.amountRequested),
    budgetBreakdown: application.budgetBreakdown,
    budgetBreakdownLink: application.budgetBreakdownLink,
    deliveryArea: application.deliveryArea,
    charityNumber: application.charityNumber,
    companyNumber: application.companyNumber,
    responses: application.responses,
  })

  await db
    .update(applications)
    .set({
      custodianScoreStatus: custodian.status,
      custodianScore: custodian.score,
      custodianScoreDetail: custodian.detail,
      grantPurpose: custodian.grantPurpose,
      custodianScoredAt: new Date(custodian.scoredAt),
    })
    .where(eq(applications.id, applicationId))

  return { ok: true, status: custodian.status, score: custodian.score }
}
