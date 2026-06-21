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
      geography: input.geography,
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
    geography: input.geography,
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
