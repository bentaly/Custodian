// ─── Ingest orchestrator ─────────────────────────────────────────────────────
//
// Turns a raw foundation payload into either a real application (when all required
// canonical fields resolve) or a held `application_ingests` row for human review.
//
// Flow: resolve client + open-check → lookup-table match → AI fallback for any
// unresolved required fields (proposals above the confidence threshold are
// applied) → decide status → validate the assembled canonical input → promote or
// hold. `externalApplicationId` gives idempotency: a re-sent payload returns the
// existing record instead of creating a duplicate.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests, fieldMappings } from '../../../drizzle/schema'
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
  fetchRoundProgrammeForApplication,
} from '../applications/create'
import { CreateApplicationSchema } from '../../lib/validators/application'
import { getRoundStatus } from '../../lib/roundStatus'

const AI_CONFIDENCE_THRESHOLD = 0.85

export interface IngestParams {
  roundProgrammeId: string
  externalApplicationId?: string
  payload: Record<string, unknown>
  /** Injectable AI assessor for tests. */
  assess?: FieldMappingAssessor
}

export type IngestStatus = 'complete' | 'ai_proposed' | 'needs_review'

export type IngestResult =
  | { ok: false; error: 'not_found' | 'round_closed' }
  | {
      ok: true
      status: IngestStatus
      ingestId: string
      applicationId: string | null
      duplicate: boolean
    }

export async function ingestApplication(params: IngestParams): Promise<IngestResult> {
  const roundProgramme = await fetchRoundProgrammeForApplication(params.roundProgrammeId)
  if (!roundProgramme) return { ok: false, error: 'not_found' }
  if (getRoundStatus(roundProgramme.round) !== 'open') return { ok: false, error: 'round_closed' }

  const clientId = roundProgramme.programme.client.id
  const { payload } = params

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

  // 4. Build responses (leftover payload) and the stored resolved map.
  const responses = computeResponses(payload, resolved)
  const resolvedMap = resolvedMapFor(resolved)

  const externalApplicationId =
    resolved.externalApplicationId?.value ?? params.externalApplicationId ?? null

  // 6. Idempotency: a re-sent payload returns the existing record.
  if (externalApplicationId) {
    const existing = await getDb().query.applicationIngests.findFirst({
      where: and(
        eq(applicationIngests.clientId, clientId),
        eq(applicationIngests.externalApplicationId, externalApplicationId),
      ),
      columns: { id: true, status: true, applicationId: true },
    })
    if (existing) {
      return {
        ok: true,
        status: existing.status,
        ingestId: existing.id,
        applicationId: existing.applicationId,
        duplicate: true,
      }
    }
  }

  // 7. Decide status, validating the assembled canonical input. A required field
  // that resolved to an invalid value (e.g. an amount that won't parse) is treated
  // as unresolved → needs_review.
  let status: IngestStatus
  let validInput: ReturnType<typeof CreateApplicationSchema.safeParse> | null = null

  if (unresolvedRequired.length === 0) {
    validInput = CreateApplicationSchema.safeParse(
      buildCanonicalInput(params.roundProgrammeId, resolved, responses),
    )
    status = validInput.success ? (aiUsed ? 'ai_proposed' : 'complete') : 'needs_review'
  } else {
    status = 'needs_review'
  }

  // 8. Promote (create the application) or hold for review.
  let applicationId: string | null = null
  if (status !== 'needs_review' && validInput?.success) {
    const created = await createApplicationFromCanonical(roundProgramme, validInput.data)
    applicationId = created.application?.id ?? null
  }

  const [ingest] = await getDb()
    .insert(applicationIngests)
    .values({
      clientId,
      roundProgrammeId: params.roundProgrammeId,
      externalApplicationId,
      rawPayload: payload,
      status,
      proposed,
      resolved: resolvedMap,
      applicationId,
      resolvedAt: status === 'needs_review' ? null : new Date(),
    })
    .returning({ id: applicationIngests.id })

  return { ok: true, status, ingestId: ingest!.id, applicationId, duplicate: false }
}
