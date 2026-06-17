// ─── Shared application-create core ──────────────────────────────────────────
//
// The DD + Custodian-score + insert pipeline, factored out of the public
// /api/apply route so both the direct (canonical) submission path and the
// field-mapping ingest promotion path create applications identically.
//
// The round-open check is intentionally NOT done here — it belongs at the entry
// points (a submission is rejected if the round is closed, but an already-ingested
// application may be promoted by a reviewer after the round has closed).

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, roundProgrammes } from '../../../drizzle/schema'
import { runDueDiligence } from '../dueDiligence/run'
import { runCustodianScore } from '../custodianScore/run'
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

export async function createApplicationFromCanonical(
  roundProgramme: RoundProgrammeForApplication,
  input: CreateApplicationInput,
) {
  const programme = roundProgramme.programme

  // Due diligence (external registers) and AI scoring are independent — run them
  // concurrently. Both never throw; a failure surfaces as a status, never a
  // blocked submission.
  const [dueDiligence, custodian] = await Promise.all([
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
      responses: input.responses,
    }),
  ])

  const id = crypto.randomUUID()
  await getDb().insert(applications).values({
    id,
    roundProgrammeId: input.roundProgrammeId,
    externalApplicationId: input.externalApplicationId,
    organisationName: input.organisationName,
    charityNumber: input.charityNumber,
    companyNumber: input.companyNumber,
    bankName: input.bankName,
    bankAccountName: input.bankAccountName,
    bankAccountNumber: input.bankAccountNumber,
    bankSortCode: input.bankSortCode,
    amountRequested: String(input.amountRequested),
    responses: input.responses,
    dueDiligenceStatus: dueDiligence.status,
    dueDiligenceChecks: dueDiligence.checks,
    dueDiligenceCheckedAt: new Date(dueDiligence.checkedAt),
    custodianScoreStatus: custodian.status,
    custodianScore: custodian.score,
    custodianScoreDetail: custodian.detail,
    custodianScoredAt: new Date(custodian.scoredAt),
  })

  const application = await getDb().query.applications.findFirst({
    where: (a, { eq }) => eq(a.id, id),
  })

  return { application, dueDiligence, custodian }
}
