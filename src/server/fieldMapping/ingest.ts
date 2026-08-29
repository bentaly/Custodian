// ─── Ingest orchestrator ─────────────────────────────────────────────────────
//
// Turns a raw foundation payload into either a real application (when all required
// canonical fields resolve) or a held `application_ingests` row for human review.
//
// Split into two halves so the public route can acknowledge fast:
//   saveIngest    — persist the raw payload as a `received` row and nothing else.
//                   Once this returns, the submission can never be lost; the route
//                   responds 202 immediately after.
//   processIngest — the pipeline, run in the background (see server/background.ts):
//                   lookup-table match → built-in common-dictionary match (curated,
//                   certain aliases auto-applied, same standing as a lookup hit) →
//                   AI fallback for any field still unresolved, required OR optional
//                   (proposals above the confidence threshold ARE applied) → resolve
//                   programme → decide status → validate the assembled canonical
//                   input → promote or hold, updating the row in place. A crash
//                   leaves the row at `received` — visible, and reprocessable from
//                   the admin queue, never dropped.
//
// The foundation's own application reference is just the `externalApplicationId`
// canonical field, resolved by mapping like any other. If `programmeName` can't be
// matched to a programme in an active round (no match, or the round is closed), the
// ingest is held for human review with a null roundProgrammeId.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests, fieldMappings } from '../../../drizzle/schema'
import {
  applyLookup,
  matchCommonKey,
  toStringValue,
  CANONICAL_FIELD_BY_KEY,
  CANONICAL_KEYS,
  REQUIRED_CANONICAL_KEYS,
  unmetOneOfGroups,
  type LookupResult,
  type ProposalMap,
} from '../../lib/fieldMapping'
import { runFieldMapping, type FieldMappingAssessor } from './run'
import {
  buildCanonicalInput,
  buildSubmittedFields,
  computeResponses,
  resolvedMapFor,
} from './assemble'
import {
  createApplicationFromCanonical,
  findActiveRoundProgrammeByName,
  type RoundProgrammeForApplication,
} from '../applications/create'
import { CreateApplicationSchema } from '../../lib/validators/application'
import { scoreApplication } from '../applications/score'
import { enqueue } from '../pipelineQueue'

const AI_CONFIDENCE_THRESHOLD = 0.85

export type IngestStatus = 'complete' | 'ai_proposed' | 'needs_review'

/** Persist the raw payload immediately, before any processing can fail. The caller
 *  (the /api/apply route) has already resolved the client from the API key, so the
 *  client is known to exist. Returns the new ingest's id. */
export async function saveIngest(params: {
  clientId: string
  payload: Record<string, unknown>
  /** Supply to make the write idempotent across a retry — see below. */
  id?: string
}): Promise<string> {
  // The id is generated HERE rather than by the database, so this insert can be
  // repeated safely. `db.ts` deliberately never retries a write, because a write that
  // times out may still have committed and a blind retry would duplicate the row —
  // but with the id fixed in advance the second attempt is the same row, and
  // `onConflictDoNothing` makes it a no-op. This is the one write that stands between
  // a submission and being lost entirely: everything downstream can fail and be
  // reprocessed, whereas a failure here returns 5xx and the applicant's answers exist
  // nowhere but in the sender's retry buffer.
  const id = params.id ?? crypto.randomUUID()
  await getDb()
    .insert(applicationIngests)
    .values({
      id,
      clientId: params.clientId,
      rawPayload: params.payload,
      // The one moment the sender's field order exists. `rawPayload` is about to
      // become jsonb, which sorts object keys by length and then bytewise, so reading
      // it back gives an order no applicant ever saw — and `responses` inherited it,
      // which is what made a 38-question form read as a jumble on the application.
      // Captured here rather than derived later because later is too late.
      fieldOrder: Object.keys(params.payload),
      status: 'received',
    })
    .onConflictDoNothing({ target: applicationIngests.id })
  return id
}

export type ProcessIngestResult =
  | { ok: false; error: 'not_found' | 'not_received' }
  | { ok: true; status: IngestStatus; applicationId: string | null }

/** Run the mapping pipeline over a `received` ingest row and update it in place.
 *  Skips rows in any other state, so a row is never processed twice. */
export async function processIngest(
  ingestId: string,
  opts: { assess?: FieldMappingAssessor } = {},
): Promise<ProcessIngestResult> {
  const ingest = await getDb().query.applicationIngests.findFirst({
    where: eq(applicationIngests.id, ingestId),
  })
  if (!ingest) return { ok: false, error: 'not_found' }
  if (ingest.status !== 'received') return { ok: false, error: 'not_received' }

  const { clientId, rawPayload: payload, fieldOrder } = ingest

  // 1. Lookup-table match.
  const mappings = await getDb().query.fieldMappings.findMany({
    where: and(eq(fieldMappings.clientId, clientId), eq(fieldMappings.formType, 'application')),
    columns: { sourceKey: true, canonicalField: true },
  })
  const lookup = applyLookup(payload, mappings)
  const resolved: LookupResult['resolved'] = { ...lookup.resolved }

  // 2. Built-in common dictionary: auto-apply known-good, unambiguous aliases the
  //    client's own table didn't already resolve. The dictionary is curated to
  //    only-certain mappings (e.g. "bank acc no" → bankAccountNumber), so a match
  //    is applied directly with the same standing as a per-client lookup hit — no
  //    review. The client's own table ran first and still wins, so a client can
  //    override any alias. First matching leftover key wins; empty values skip.
  const commonConsumed = new Set<string>()
  for (const key of lookup.leftoverKeys) {
    const canonical = matchCommonKey(key)
    if (!canonical || resolved[canonical]) continue
    const value = toStringValue(payload[key])
    if (!value) continue
    resolved[canonical] = { sourceKey: key, value }
    commonConsumed.add(key)
  }

  // 3. AI fallback for any canonical field still unresolved — REQUIRED AND OPTIONAL.
  //
  //    Optional fields are offered deliberately. They used to be excluded, which meant
  //    they could only ever be resolved by an exact string match (the client's lookup
  //    table, or the curated dictionary) — so a foundation whose form says "Organisation
  //    registration number" rather than "Charity number" silently lost due diligence,
  //    and one asking "Where will the work happen?" silently lost deprivation context.
  //    The value survived in `responses`, but never reached the typed column the feature
  //    reads, and nothing anywhere reported a problem. The AI fallback is exactly the
  //    mechanism that copes with wording the dictionary can't anticipate; withholding
  //    the optional fields from it was the bug.
  //
  //    Only payload keys not already consumed by the lookup table or common dictionary
  //    are offered as candidates.
  const requiredKeySet = new Set<string>(REQUIRED_CANONICAL_KEYS)
  // Required first: where two fields are proposed the same source key, the one that
  // decides whether an application can exist at all takes it.
  const unresolvedForAi = [
    ...REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k]),
    ...CANONICAL_KEYS.filter((k) => !requiredKeySet.has(k) && !resolved[k]),
  ]
  let unresolvedRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k])
  let aiUsed = false
  let proposed: ProposalMap | null = null

  if (unresolvedForAi.length > 0) {
    const proposals = await runFieldMapping(
      {
        fields: unresolvedForAi.map((k) => {
          const f = CANONICAL_FIELD_BY_KEY[k]
          return { key: f.key, label: f.label, description: f.description }
        }),
        payload: lookup.leftoverKeys
          .filter((k) => !commonConsumed.has(k))
          .map((k) => ({ key: k, value: toStringValue(payload[k]) })),
      },
      { assess: opts.assess },
    )
    proposed = proposals

    // A source key may only feed one canonical field. Without this, an ambiguous
    // label ("Organisation registration number") proposed for both charityNumber and
    // companyNumber would write the same number into both, inventing a Companies House
    // registration that was never claimed — and due diligence would then screen it
    // against the wrong register.
    const aiConsumed = new Set<string>()
    for (const key of unresolvedForAi) {
      const p = proposals[key]
      if (!p || !p.sourceKey || p.confidence <= AI_CONFIDENCE_THRESHOLD) continue
      if (aiConsumed.has(p.sourceKey)) continue
      const value = toStringValue(payload[p.sourceKey])
      if (!value) continue
      resolved[key] = { sourceKey: p.sourceKey, value }
      aiConsumed.add(p.sourceKey)
      // Only a REQUIRED field resolved by AI sends the ingest to the review queue for
      // confirmation. An optional one is a bonus — it enriches the application, and
      // holding every submission for review because the model recognised a postcode
      // would make the queue useless. A wrong optional mapping is visible and fixable
      // on the application; a wrong required one produces a bad application.
      if (requiredKeySet.has(key)) aiUsed = true
    }
    unresolvedRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k])
  }

  // 4. Resolve programme → active round. If the programme name didn't resolve, or
  //    no active round contains it, hold for human review (roundProgrammeId stays
  //    null until a reviewer picks it) rather than reject — a submission is never
  //    dropped.
  let roundProgrammeId: string | null = null
  let resolvedRoundProgramme: RoundProgrammeForApplication | null = null
  const resolvedProgrammeName = resolved.programmeName?.value ?? null

  if (resolvedProgrammeName) {
    resolvedRoundProgramme = await findActiveRoundProgrammeByName(clientId, resolvedProgrammeName)
    roundProgrammeId = resolvedRoundProgramme?.id ?? null
  }

  // 5. Build responses (leftover payload) and the stored resolved map, both in the
  //    order the applicant filled the form in rather than the order jsonb hands the
  //    payload back in.
  const responses = computeResponses(payload, resolved, fieldOrder)
  const resolvedMap = resolvedMapFor(resolved)
  const submittedFields = buildSubmittedFields(payload, resolved, fieldOrder)

  // 6. Decide status, validating the assembled canonical input. A required field
  //    that resolved to an invalid value (e.g. an amount that won't parse) is
  //    treated as unresolved → needs_review. We can only attempt validation when
  //    the round programme is known.
  //
  //    A required one-of group with no member resolved holds the submission too —
  //    "at least one of these, we don't mind which". REQUIRED_ONE_OF_GROUPS is empty
  //    today (the registration pair that used to live there is now `expected`, stated
  //    on the application instead of held), so this costs an empty loop; the check
  //    stays because the reviewer path in `resolve.ts` enforces the same rule, and the
  //    two must never disagree about what may be promoted.
  const unmetGroups = unmetOneOfGroups(Object.keys(resolved))

  let status: IngestStatus
  let validInput: ReturnType<typeof CreateApplicationSchema.safeParse> | null = null

  if (unresolvedRequired.length === 0 && unmetGroups.length === 0 && roundProgrammeId) {
    validInput = CreateApplicationSchema.safeParse(
      buildCanonicalInput(roundProgrammeId, resolved, responses, submittedFields),
    )
    status = validInput.success ? (aiUsed ? 'ai_proposed' : 'complete') : 'needs_review'
  } else {
    status = 'needs_review'
  }

  // 7. Promote (create the application, with due diligence + deprivation) or hold.
  //
  //    The ingest row is written in the SAME batch as the application insert rather
  //    than as a follow-up statement. This function only acts on rows still at
  //    `received`, so a failure between the two would leave a promoted application
  //    that no ingest points at — and the next attempt would build a SECOND
  //    application for one submission. That window was survivable while the only way
  //    to retry was a human pressing Reprocess; a queue retries on its own.
  const finalise = (promotedId: string | null) => ({
    status,
    proposed,
    resolved: resolvedMap,
    roundProgrammeId,
    applicationId: promotedId,
    resolvedAt: status === 'needs_review' ? null : new Date(),
  })

  let applicationId: string | null = null
  if (status !== 'needs_review' && validInput?.success && resolvedRoundProgramme) {
    const created = await createApplicationFromCanonical(resolvedRoundProgramme, validInput.data, {
      // The Custodian score is 30-58s of model time against ~8s for everything else
      // in this function, and it is what pushed this pipeline past the 30 seconds
      // Cloudflare allows after a response. The application is complete and usable
      // without it; the score follows. See server/applications/score.ts.
      score: 'queued',
      alsoInBatch: (newId, db) =>
        db
          .update(applicationIngests)
          .set(finalise(newId))
          .where(eq(applicationIngests.id, ingestId)),
    })
    applicationId = created.application?.id ?? null
  } else {
    await getDb()
      .update(applicationIngests)
      .set(finalise(null))
      .where(eq(applicationIngests.id, ingestId))
  }

  // Ask for the score only once the application and its ingest row are committed, so
  // a message can never point at a row that does not exist yet.
  if (applicationId) {
    const promotedId = applicationId
    await enqueue({ kind: 'score', applicationId: promotedId }, () => scoreApplication(promotedId))
  }

  return { ok: true, status, applicationId }
}
