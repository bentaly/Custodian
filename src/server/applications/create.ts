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
import type { BatchItem } from 'drizzle-orm/batch'
import { getDb } from '../db'
import { applications, programmes, roundProgrammes, rounds } from '../../../drizzle/schema'
import { runDueDiligence } from '../dueDiligence/run'
import { runCustodianScore } from '../custodianScore/run'
import { resolveDeprivation } from '../deprivation/run'
import { deliveryGeoFromResult } from '../../lib/deprivation/types'
import type { CreateApplicationInput } from '../../lib/validators/application'
import { bankFields } from './bank'

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

/** Find the open roundProgramme for a client where the programme name matches
 *  (case-insensitive, and insensitive to surrounding whitespace).
 *
 *  Both sides are trimmed because a programme name carrying a trailing space is
 *  INVISIBLE everywhere a human would look for it: the rounds dialog, the programme
 *  card and the admin queue's "no programme called X" blocker all render it with the
 *  space collapsed away, so a reviewer is shown two identical strings and told they
 *  don't match. Arete's live programme was stored as "Long-term local partnerships "
 *  and every submission to it held at `programme_unknown` with nothing on any screen
 *  to explain why. The save path now trims too (SaveProgrammeSchema), but trimming
 *  here as well is what fixes the rows already stored.
 *
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
        sql`lower(trim(${programmes.name})) = lower(trim(${programmeName}))`,
        lte(rounds.openedAt, now),
        or(isNull(rounds.closedAt), gt(rounds.closedAt, now)),
      ),
    )
    .orderBy(sql`${rounds.openedAt} desc`)
    .limit(1)

  if (!rows.length) return null
  return (await fetchRoundProgrammeForApplication(rows[0]!.id)) ?? null
}

/** The drizzle instance, so a caller's `alsoInBatch` statement is built on the SAME
 *  session the batch executes on rather than a second `getDb()`. */
export type Database = ReturnType<typeof getDb>

export interface CreateApplicationOptions {
  /**
   * How the Custodian score is produced.
   *
   * `inline` scores before the row is written — right for a reviewer who pressed
   * Confirm and is watching, in a request with no post-response deadline.
   *
   * `queued` writes the application with `custodianScoreStatus: 'queued'` and leaves
   * scoring to its own later step. The score is 30-60s of model time against roughly
   * 8s for everything else here, so keeping it inline is what made a submission's
   * whole pipeline outlive the invocation that started it.
   */
  score?: 'inline' | 'queued'
  /**
   * A statement to commit in the SAME batch as the application insert.
   *
   * This exists because "the application row" and "the ingest row that points at it"
   * are one fact, and writing them as two statements leaves a window where the
   * application exists and nothing records that it does. `processIngest` only acts on
   * rows still at `received`, so a retry landing in that window creates a SECOND
   * application for one submission. Harmless while nothing retried automatically —
   * live the moment a queue does it for us.
   */
  alsoInBatch?: (applicationId: string, db: Database) => BatchItem<'pg'>
}

export async function createApplicationFromCanonical(
  roundProgramme: RoundProgrammeForApplication,
  input: CreateApplicationInput,
  opts: CreateApplicationOptions = {},
) {
  const programme = roundProgramme.programme
  const scoreMode = opts.score ?? 'inline'

  // Due diligence (external registers) and AI scoring are independent — run them
  // concurrently. Both never throw; a failure surfaces as a status, never a
  // blocked submission.
  const [dueDiligence, custodian, deprivation] = await Promise.all([
    runDueDiligence({
      charityNumber: input.charityNumber,
      companyNumber: input.companyNumber,
      amountRequested: input.amountRequested,
    }),
    scoreMode === 'inline'
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
    resolveDeprivation(input.deliveryArea),
  ])
  const deprivationAttempted = deprivation.status !== 'pending'
  const deprivationGeo = deliveryGeoFromResult(deprivation)

  const id = crypto.randomUUID()
  const db = getDb()
  const insertApplication = db.insert(applications).values({
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
    ...bankFields(input),
    amountRequested: String(input.amountRequested),
    proposedImpactQuantity:
      input.proposedImpactQuantity != null ? String(input.proposedImpactQuantity) : null,
    budgetBreakdown: input.budgetBreakdown ?? null,
    budgetBreakdownLink: input.budgetBreakdownLink ?? null,
    responses: input.responses,
    dueDiligenceStatus: dueDiligence.status,
    dueDiligenceChecks: dueDiligence.checks,
    dueDiligenceCheckedAt: new Date(dueDiligence.checkedAt),
    custodianScoreStatus: custodian?.status ?? ('queued' as const),
    custodianScore: custodian?.score ?? null,
    custodianScoreDetail: custodian?.detail ?? null,
    grantPurpose: custodian?.grantPurpose ?? null,
    // Null, not now(): nothing has been scored yet, and a timestamp here would
    // read as "assessed a moment ago, and it had nothing to say".
    custodianScoredAt: custodian ? new Date(custodian.scoredAt) : null,
    deprivationStatus: deprivation.status,
    deprivationContext: deprivationAttempted ? deprivation : null,
    deprivationResolvedAt: deprivationAttempted ? new Date() : null,
    deliveryNation: deprivationGeo.nation,
    deliveryRegion: deprivationGeo.region,
    deliveryLadCode: deprivationGeo.ladCode,
    deliveryLadName: deprivationGeo.ladName,
  })

  // Spelled out either side rather than built from an array because drizzle types
  // `batch` on its tuple arity — same reason as `createAwards`.
  const alsoInBatch = opts.alsoInBatch?.(id, db)
  if (alsoInBatch) {
    await db.batch([insertApplication, alsoInBatch])
  } else {
    await insertApplication
  }

  const application = await db.query.applications.findFirst({
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
      ...bankFields(input),
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
            // Only when the re-run produced one. A failed score sets the status and the
            // error detail, but must not blank a purpose an admin may already have read
            // on the shortlist — or worse, be about to award from.
            ...(custodian.grantPurpose ? { grantPurpose: custodian.grantPurpose } : {}),
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
