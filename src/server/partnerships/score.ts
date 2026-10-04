// ─── The AI assessment of a sourced partner ──────────────────────────────────
//
// The same `runCustodianScore` an application gets, on the same six criteria, written to
// the same four columns. Reused rather than given criteria of its own for one reason:
// **a score is stated on one scale** (CLAUDE.md). A partner taken straight to the
// shortlist becomes an application, and trustees vote on it beside applications that
// came through a form; a second rubric would put two differently-built numbers in one
// column with nothing to say which was which.
//
// What differs is what the model is told it is looking at (`sourced: true`): staff's
// note of a possible grant plus the register's record, not an organisation's answers to
// a form. See `buildUserPrompt`.
//
// It needs three things to run (`assessmentGaps`): a programme, because that is the
// yardstick; a proposed value; and a proposed purpose. Without them the row sits at
// `waiting`, and the screen says what for.
//
// Self-guarding like `scoreApplication`: it only acts on a row at `queued` unless forced,
// so a redelivered queue message spends no second model call.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { partnerships } from '../../../drizzle/schema'
import { runCustodianScore } from '../custodianScore/run'
import { resolveDeprivation } from '../deprivation/run'
import { assessmentGaps } from '../../lib/partnerships/status'
import type { CustodianScoreStatus } from '../../lib/custodianScore/types'

export type ScorePartnershipResult =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_queued'; status: string }
  | { ok: true; status: CustodianScoreStatus; score: number | null }

export async function scorePartnership(
  partnershipId: string,
  opts: { force?: boolean } = {},
): Promise<ScorePartnershipResult> {
  const db = getDb()
  const partnership = await db.query.partnerships.findFirst({
    where: eq(partnerships.id, partnershipId),
    with: { programme: { with: { client: { with: { profile: true } } } } },
  })
  if (!partnership) return { ok: false, reason: 'not_found' }
  if (partnership.custodianScoreStatus !== 'queued' && !opts.force) {
    return { ok: false, reason: 'not_queued', status: partnership.custodianScoreStatus }
  }

  const programme = partnership.programme
  if (!programme || assessmentGaps(partnership).length > 0) {
    await db
      .update(partnerships)
      .set({ custodianScoreStatus: 'waiting' })
      .where(eq(partnerships.id, partnershipId))
    return { ok: true, status: 'waiting', score: null }
  }

  // Read fresh rather than stored: the partnership has no deprivation columns of its
  // own, and the reading is cheap beside the model call it feeds. Never throws.
  const deprivation = await resolveDeprivation(partnership.deliveryArea)

  // Never throws: a model failure comes back as `error`, visible and re-runnable.
  const result = await runCustodianScore({
    sourced: true,
    missionStatement: programme.client.profile?.missionStatement,
    programmeName: programme.name,
    programmeGoal: programme.goal,
    programmeDescription: programme.description,
    programmeThemes: programme.tags,
    grantDurationYears: null,
    organisationName: partnership.organisationName,
    organisationSummary: null,
    amountRequested: Number(partnership.amountSought),
    unrestrictedReserves: null,
    budgetBreakdown: null,
    budgetBreakdownLink: null,
    deliveryArea: partnership.deliveryArea,
    deprivation,
    proposedImpactQuantity:
      partnership.proposedImpactQuantity != null
        ? Number(partnership.proposedImpactQuantity)
        : null,
    impactUnit: programme.impactUnit,
    impactUnitLabel: programme.impactUnitLabel,
    charityNumber: partnership.charityNumber,
    companyNumber: partnership.companyNumber,
    organisationProfile: partnership.organisationProfile,
    responses: [{ label: 'Proposed purpose', value: partnership.proposedPurpose ?? '' }],
  })

  await db
    .update(partnerships)
    .set({
      custodianScoreStatus: result.status,
      custodianScore: result.score,
      custodianScoreDetail: result.detail,
      custodianScoredAt: new Date(result.scoredAt),
      // Themes come from the same call, chosen from the programme's own list. Written
      // only where nobody has chosen any: a person's themes outrank the model's, and a
      // failed run (`themes: null`) must not blank what is there.
      ...(result.themes && result.themes.length > 0 && (partnership.tags ?? []).length === 0
        ? { tags: result.themes }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(partnerships.id, partnershipId))

  return { ok: true, status: result.status, score: result.score }
}
