// ─── Ingest orchestrator ─────────────────────────────────────────────────────
//
// Turns a raw foundation payload into either a real application (when all required
// canonical fields resolve) or a held `application_ingests` row for human review.
//
// Flow: resolve programme name → find active round → lookup-table match → AI
// fallback for any unresolved required fields (proposals above the confidence
// threshold are applied) → decide status → validate the assembled canonical
// input → promote or hold. `externalApplicationId` gives idempotency: a re-sent
// payload returns the existing record instead of creating a duplicate.
//
// If `programmeName` can't be matched to a programme in an active round (no match,
// or the round is closed), the ingest is still saved and held for human review with
// a null roundProgrammeId — a submission is never dropped. The only hard failure is
// an unknown `clientId`.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests, clients, fieldMappings } from '../../../drizzle/schema'
import {
  applyLookup,
  toStringValue,
  CANONICAL_FIELD_BY_KEY,
  REQUIRED_CANONICAL_KEYS,
  type LookupResult,
} from '../../lib/fieldMapping'
import { runFieldMapping, type FieldMappingAssessor } from './run'
import {
  buildCanonicalInput,
  computeResponses,
  resolvedMapFor,
  PROVIDED,
} from './assemble'
import {
  createApplicationFromCanonical,
  findActiveRoundProgrammeByName,
  type RoundProgrammeForApplication,
} from '../applications/create'
import { CreateApplicationSchema } from '../../lib/validators/application'

const AI_CONFIDENCE_THRESHOLD = 0.85

export interface IngestParams {
  clientId: string
  externalApplicationId?: string
  payload: Record<string, unknown>
  /** Injectable AI assessor for tests. */
  assess?: FieldMappingAssessor
}

export type IngestStatus = 'complete' | 'ai_proposed' | 'needs_review'

type CreatedApplication = Awaited<ReturnType<typeof createApplicationFromCanonical>>

export type IngestResult =
  | { ok: false; error: 'client_not_found' }
  | {
      ok: true
      status: IngestStatus
      ingestId: string
      applicationId: string | null
      /** Present when this ingest created an application (complete / ai_proposed). */
      created?: CreatedApplication
    }

export async function ingestApplication(params: IngestParams): Promise<IngestResult> {
  const { clientId, payload } = params

  // 0. The client (foundation) must exist — the only hard rejection.
  const client = await getDb().query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { id: true },
  })
  if (!client) return { ok: false, error: 'client_not_found' }

  // 1. Lookup-table match.
  const mappings = await getDb().query.fieldMappings.findMany({
    where: eq(fieldMappings.clientId, clientId),
    columns: { sourceKey: true, canonicalField: true },
  })
  const lookup = applyLookup(payload, mappings)
  const resolved: LookupResult['resolved'] = { ...lookup.resolved }

  // 2. A caller-provided external id pre-resolves that field.
  if (params.externalApplicationId && !resolved.externalApplicationId) {
    resolved.externalApplicationId = { sourceKey: PROVIDED, value: params.externalApplicationId }
  }

  // 3. AI fallback for any required field still unresolved.
  let unresolvedRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k])
  let aiUsed = false
  let proposed: Record<string, { sourceKey: string | null; confidence: number }> | null = null

  if (unresolvedRequired.length > 0) {
    const proposals = await runFieldMapping(
      {
        fields: unresolvedRequired.map((k) => {
          const f = CANONICAL_FIELD_BY_KEY[k]
          return { key: f.key, label: f.label, description: f.description }
        }),
        payload: lookup.leftoverKeys.map((k) => ({ key: k, value: toStringValue(payload[k]) })),
      },
      { assess: params.assess },
    )
    proposed = proposals as Record<string, { sourceKey: string | null; confidence: number }>

    for (const key of unresolvedRequired) {
      const p = proposals[key]
      if (!p || !p.sourceKey || p.confidence <= AI_CONFIDENCE_THRESHOLD) continue
      const value = toStringValue(payload[p.sourceKey])
      if (!value) continue
      resolved[key] = { sourceKey: p.sourceKey, value }
      aiUsed = true
    }
    unresolvedRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k])
  }

  // 4. Resolve programme → active round. If the programme name resolved but no
  //    active round exists for it, reject immediately. If it didn't resolve, hold
  //    for human review (roundProgrammeId stays null until a reviewer picks it).
  let roundProgrammeId: string | null = null
  let resolvedRoundProgramme: RoundProgrammeForApplication | null = null
  const resolvedProgrammeName = resolved.programmeName?.value ?? null

  if (resolvedProgrammeName) {
    resolvedRoundProgramme = await findActiveRoundProgrammeByName(clientId, resolvedProgrammeName)
    // No active round for that programme name → hold for review (roundProgrammeId
    // stays null) rather than reject, so the submission is never dropped.
    roundProgrammeId = resolvedRoundProgramme?.id ?? null
  }

  // 5. Build responses (leftover payload) and the stored resolved map.
  const responses = computeResponses(payload, resolved)
  const resolvedMap = resolvedMapFor(resolved)

  const externalApplicationId =
    resolved.externalApplicationId?.value ?? params.externalApplicationId ?? null

  // 6. Decide status, validating the assembled canonical input. A required field
  //    that resolved to an invalid value (e.g. an amount that won't parse) is
  //    treated as unresolved → needs_review. We can only attempt validation when
  //    the round programme is known.
  let status: IngestStatus
  let validInput: ReturnType<typeof CreateApplicationSchema.safeParse> | null = null

  if (unresolvedRequired.length === 0 && roundProgrammeId) {
    validInput = CreateApplicationSchema.safeParse(
      buildCanonicalInput(roundProgrammeId, resolved, responses),
    )
    status = validInput.success ? (aiUsed ? 'ai_proposed' : 'complete') : 'needs_review'
  } else {
    status = 'needs_review'
  }

  // 7. Promote (create the application) or hold for review.
  let applicationId: string | null = null
  let created: CreatedApplication | undefined
  if (status !== 'needs_review' && validInput?.success && resolvedRoundProgramme) {
    created = await createApplicationFromCanonical(resolvedRoundProgramme, validInput.data)
    applicationId = created.application?.id ?? null
  }

  const [ingest] = await getDb()
    .insert(applicationIngests)
    .values({
      clientId,
      roundProgrammeId,
      externalApplicationId,
      rawPayload: payload,
      status,
      proposed,
      resolved: resolvedMap,
      applicationId,
      resolvedAt: status === 'needs_review' ? null : new Date(),
    })
    .returning({ id: applicationIngests.id })

  return { ok: true, status, ingestId: ingest!.id, applicationId, created }
}
