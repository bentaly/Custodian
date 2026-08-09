// ─── Shared application-create core ──────────────────────────────────────────
//
// The DD + Custodian-score + insert pipeline, factored out of the public
// /api/apply route so both the direct (canonical) submission path and the
// field-mapping ingest promotion path create applications identically.
//
// The round-open check is intentionally NOT done here — it belongs at the entry
// points (a submission is rejected if the round is closed, but an already-ingested
// application may be promoted by a reviewer after the round has closed).

import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, programmes, roundProgrammes, rounds } from '../../../drizzle/schema'
import { runDueDiligence } from '../dueDiligence/run'
import { runCustodianScore } from '../custodianScore/run'
import { resolveDeprivation } from '../deprivation/run'
import { deliveryGeoFromResult } from '../../lib/deprivation/types'
import type { CreateApplicationInput } from '../../lib/validators/application'

/** Fetch a round programme with everything the create pipeline needs (round for
 *  the open-check at the call site, programme + client profile for scoring). */
export async function fetchRoundProgrammeForApplication(roundProgrammeId: string) {
  return getDb().query.roundProgrammes.findFirst({
    where: eq(roundProgrammes.id, roundProgrammeId),
    with: {
      round: true,
      programme: { with: { client: { with: { profile: true } } } },
    },
  })
}

export type RoundProgrammeForApplication = NonNullable<
  Awaited<ReturnType<typeof fetchRoundProgrammeForApplication>>
>

/** Find the open roundProgramme for a client where the programme name matches (case-insensitive).
 *  Returns null when no active round contains a programme with that name. */
export async function findActiveRoundProgrammeByName(
  clientId: string,
  programmeName: string,
): Promise<RoundProgrammeForApplication | null> {
  const now = new Date()
  const rows = await getDb()
    .select({ id: roundProgrammes.id })
    .from(roundProgrammes)
    .innerJoin(rounds, eq(roundProgrammes.roundId, rounds.id))
    .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .where(
      and(
        eq(programmes.clientId, clientId),
        sql`lower(${programmes.name}) = lower(${programmeName})`,
        lte(rounds.openedAt, now),
        or(isNull(rounds.closedAt), gt(rounds.closedAt, now)),
      ),
    )
    .orderBy(sql`${rounds.openedAt} desc`)
    .limit(1)

  if (!rows.length) return null
  return (await fetchRoundProgrammeForApplication(rows[0]!.id)) ?? null
}

export async function createApplicationFromCanonical(
  roundProgramme: RoundProgrammeForApplication,
  input: CreateApplicationInput,
) {
  const programme = roundProgramme.programme

  // Due diligence (external registers) and AI scoring are independent — run them
  // concurrently. Both never throw; a failure surfaces as a status, never a
  // blocked submission.
  const [dueDiligence, custodian, deprivation] = await Promise.all([
    runDueDiligence({
      charityNumber: input.charityNumber,
      companyNumber: input.companyNumber,
      amountRequested: input.amountRequested,
    }),
    runCustodianScore({
      missionStatement: programme.client.profile?.missionStatement,
      programmeName: programme.name,
      programmeGoal: programme.goal,
      programmeDescription: programme.description,
      organisationName: input.organisationName,
      amountRequested: input.amountRequested,
      budgetBreakdown: input.budgetBreakdown,
      budgetBreakdownLink: input.budgetBreakdownLink,
      deliveryArea: input.deliveryArea,
      charityNumber: input.charityNumber,
      companyNumber: input.companyNumber,
      responses: input.responses,
    }),
    resolveDeprivation(input.deliveryArea),
  ])
  const deprivationAttempted = deprivation.status !== 'pending'
  const deprivationGeo = deliveryGeoFromResult(deprivation)

  const id = crypto.randomUUID()
  await getDb()
    .insert(applications)
    .values({
      id,
      roundProgrammeId: input.roundProgrammeId,
      externalApplicationId: input.externalApplicationId,
      organisationName: input.organisationName,
      applicantEmail: input.applicantEmail,
      charityNumber: input.charityNumber,
      companyNumber: input.companyNumber,
      deliveryArea: input.deliveryArea,
      bankName: input.bankName,
      bankAccountName: input.bankAccountName,
      bankAccountNumber: input.bankAccountNumber,
      bankSortCode: input.bankSortCode,
      amountRequested: String(input.amountRequested),
      proposedImpactQuantity:
        input.proposedImpactQuantity != null ? String(input.proposedImpactQuantity) : null,
      budgetBreakdown: input.budgetBreakdown ?? null,
      budgetBreakdownLink: input.budgetBreakdownLink ?? null,
      responses: input.responses,
      dueDiligenceStatus: dueDiligence.status,
      dueDiligenceChecks: dueDiligence.checks,
      dueDiligenceCheckedAt: new Date(dueDiligence.checkedAt),
      custodianScoreStatus: custodian.status,
      custodianScore: custodian.score,
      custodianScoreDetail: custodian.detail,
      custodianScoredAt: new Date(custodian.scoredAt),
      deprivationStatus: deprivation.status,
      deprivationContext: deprivationAttempted ? deprivation : null,
      deprivationResolvedAt: deprivationAttempted ? new Date() : null,
      deliveryNation: deprivationGeo.nation,
      deliveryRegion: deprivationGeo.region,
      deliveryLadCode: deprivationGeo.ladCode,
      deliveryLadName: deprivationGeo.ladName,
    })

  const application = await getDb().query.applications.findFirst({
    where: (a, { eq }) => eq(a.id, id),
  })

  return { application, dueDiligence, custodian }
}

/**
 * Re-apply a corrected canonical mapping to an application that already exists.
 *
 * This is the confirm path for an `ai_proposed` ingest: the pipeline created the
 * application from the model's proposal, and a reviewer has since fixed something in
 * the mapping grid. Their corrections used to be discarded — confirm only persisted
 * lookups and marked the ingest complete — so a reviewer could map the charity number
 * the model had missed, press Confirm, and the application would keep its NULL, keep
 * its `review` due diligence status, and go on returning "no identifiers to screen
 * against" however many times due diligence was re-run. The screen said the mapping
 * was confirmed; nothing said the correction had gone nowhere.
 *
 * Derived features re-run only where their INPUTS changed. Doing all three
 * unconditionally would burn an AI call on every confirm and replace a Custodian score
 * for a submission nobody edited. All three degrade gracefully, so a failure leaves a
 * status rather than blocking the confirm.
 */
export async function updateApplicationFromCanonical(
  roundProgramme: RoundProgrammeForApplication,
  applicationId: string,
  input: CreateApplicationInput,
) {
  const programme = roundProgramme.programme
  const existing = await getDb().query.applications.findFirst({
    where: (a, { eq }) => eq(a.id, applicationId),
  })
  if (!existing) return { application: null, rerun: [] as string[] }

  // Columns are nullable, the input's fields optional — treat those as equivalent.
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? '') === (b ?? '')

  const dueDiligenceInputsChanged =
    !same(existing.charityNumber, input.charityNumber) ||
    !same(existing.companyNumber, input.companyNumber) ||
    Number(existing.amountRequested) !== input.amountRequested
  const deprivationInputsChanged = !same(existing.deliveryArea, input.deliveryArea)
  // The score reads most of the application, so nearly anything a reviewer can change
  // here can move it — except the bank details, which it is never shown.
  const scoreInputsChanged =
    dueDiligenceInputsChanged ||
    deprivationInputsChanged ||
    !same(existing.organisationName, input.organisationName) ||
    !same(existing.budgetBreakdownLink, input.budgetBreakdownLink) ||
    JSON.stringify(existing.budgetBreakdown ?? null) !==
      JSON.stringify(input.budgetBreakdown ?? null) ||
    JSON.stringify(existing.responses ?? []) !== JSON.stringify(input.responses)

  const [dueDiligence, custodian, deprivation] = await Promise.all([
    dueDiligenceInputsChanged
      ? runDueDiligence({
          charityNumber: input.charityNumber,
          companyNumber: input.companyNumber,
          amountRequested: input.amountRequested,
        })
      : null,
    scoreInputsChanged
      ? runCustodianScore({
          missionStatement: programme.client.profile?.missionStatement,
          programmeName: programme.name,
          programmeGoal: programme.goal,
          programmeDescription: programme.description,
          organisationName: input.organisationName,
          amountRequested: input.amountRequested,
          budgetBreakdown: input.budgetBreakdown,
          budgetBreakdownLink: input.budgetBreakdownLink,
          deliveryArea: input.deliveryArea,
          charityNumber: input.charityNumber,
          companyNumber: input.companyNumber,
          responses: input.responses,
        })
      : null,
    deprivationInputsChanged ? resolveDeprivation(input.deliveryArea) : null,
  ])

  const deprivationGeo = deprivation ? deliveryGeoFromResult(deprivation) : null
  const deprivationAttempted = deprivation ? deprivation.status !== 'pending' : false

  await getDb()
    .update(applications)
    .set({
      externalApplicationId: input.externalApplicationId,
      organisationName: input.organisationName,
      applicantEmail: input.applicantEmail,
      charityNumber: input.charityNumber,
      companyNumber: input.companyNumber,
      deliveryArea: input.deliveryArea,
      bankName: input.bankName,
      bankAccountName: input.bankAccountName,
      bankAccountNumber: input.bankAccountNumber,
      bankSortCode: input.bankSortCode,
      amountRequested: String(input.amountRequested),
      proposedImpactQuantity:
        input.proposedImpactQuantity != null ? String(input.proposedImpactQuantity) : null,
      budgetBreakdown: input.budgetBreakdown ?? null,
      budgetBreakdownLink: input.budgetBreakdownLink ?? null,
      responses: input.responses,
      ...(dueDiligence
        ? {
            dueDiligenceStatus: dueDiligence.status,
            dueDiligenceChecks: dueDiligence.checks,
            dueDiligenceCheckedAt: new Date(dueDiligence.checkedAt),
          }
        : {}),
      ...(custodian
        ? {
            custodianScoreStatus: custodian.status,
            custodianScore: custodian.score,
            custodianScoreDetail: custodian.detail,
            custodianScoredAt: new Date(custodian.scoredAt),
          }
        : {}),
      ...(deprivation && deprivationGeo
        ? {
            deprivationStatus: deprivation.status,
            deprivationContext: deprivationAttempted ? deprivation : null,
            deprivationResolvedAt: deprivationAttempted ? new Date() : null,
            deliveryNation: deprivationGeo.nation,
            deliveryRegion: deprivationGeo.region,
            deliveryLadCode: deprivationGeo.ladCode,
            deliveryLadName: deprivationGeo.ladName,
          }
        : {}),
    })
    .where(eq(applications.id, applicationId))

  const application = await getDb().query.applications.findFirst({
    where: (a, { eq }) => eq(a.id, applicationId),
  })

  // Named so the admin app can say what the confirm actually did, rather than leaving
  // the reviewer to guess whether their correction took effect.
  const rerun = [
    dueDiligence ? 'due diligence' : null,
    custodian ? 'the Custodian score' : null,
    deprivation ? 'the deprivation lookup' : null,
  ].filter((x): x is string => x !== null)

  return { application, rerun }
}
