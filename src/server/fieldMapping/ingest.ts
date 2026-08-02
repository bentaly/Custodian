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
import { buildCanonicalInput, computeResponses, resolvedMapFor } from './assemble'
import {
  createApplicationFromCanonical,
  findActiveRoundProgrammeByName,
  type RoundProgrammeForApplication,
} from '../applications/create'
import { CreateApplicationSchema } from '../../lib/validators/application'

const AI_CONFIDENCE_THRESHOLD = 0.85

export type IngestStatus = 'complete' | 'ai_proposed' | 'needs_review'

/** Persist the raw payload immediately, before any processing can fail. The caller
 *  (the /api/apply route) has already resolved the client from the API key, so the
 *  client is known to exist. Returns the new ingest's id. */
export async function saveIngest(params: {
  clientId: string
  payload: Record<string, unknown>
}): Promise<string> {
  const [ingest] = await getDb()
    .insert(applicationIngests)
    .values({
      clientId: params.clientId,
      rawPayload: params.payload,
      status: 'received',
    })
    .returning({ id: applicationIngests.id })
  return ingest!.id
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

  const { clientId, rawPayload: payload } = ingest

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

  // 5. Build responses (leftover payload) and the stored resolved map.
  const responses = computeResponses(payload, resolved)
  const resolvedMap = resolvedMapFor(resolved)

  // 6. Decide status, validating the assembled canonical input. A required field
  //    that resolved to an invalid value (e.g. an amount that won't parse) is
  //    treated as unresolved → needs_review. We can only attempt validation when
  //    the round programme is known.
  //
  //    A one-of group with no member resolved holds the submission too. Neither
  //    `charityNumber` nor `companyNumber` is required on its own — an applicant may
  //    hold either — but with neither there is no registry to screen against, so due
  //    diligence can never run for this application. Left as two plain optionals that
  //    promoted quietly, which is how a submission reached an admin looking screened
  //    when it had never been checked at all. Holding costs a reviewer a few seconds
  //    and the pair is usually one ambiguous label away from resolving.
  const unmetGroups = unmetOneOfGroups(Object.keys(resolved))

  let status: IngestStatus
  let validInput: ReturnType<typeof CreateApplicationSchema.safeParse> | null = null

  if (unresolvedRequired.length === 0 && unmetGroups.length === 0 && roundProgrammeId) {
    validInput = CreateApplicationSchema.safeParse(
      buildCanonicalInput(roundProgrammeId, resolved, responses),
    )
    status = validInput.success ? (aiUsed ? 'ai_proposed' : 'complete') : 'needs_review'
  } else {
    status = 'needs_review'
  }

  // 7. Promote (create the application, with scoring + due diligence) or hold.
  let applicationId: string | null = null
  if (status !== 'needs_review' && validInput?.success && resolvedRoundProgramme) {
    const created = await createApplicationFromCanonical(resolvedRoundProgramme, validInput.data)
    applicationId = created.application?.id ?? null
  }

  await getDb()
    .update(applicationIngests)
    .set({
      status,
      proposed,
      resolved: resolvedMap,
      roundProgrammeId,
      applicationId,
      resolvedAt: status === 'needs_review' ? null : new Date(),
    })
    .where(eq(applicationIngests.id, ingestId))

  return { ok: true, status, applicationId }
}
