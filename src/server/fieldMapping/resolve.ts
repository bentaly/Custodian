// ─── Admin resolve ───────────────────────────────────────────────────────────
//
// A reviewer completes a held ingest: their `canonicalField → sourceKey` mapping
// is validated into a real application, the application is created, the ingest is
// marked complete, and any fields flagged `addToLookup` are persisted to the
// foundation's lookup table so the same source key resolves automatically next time.
//
// An `ai_proposed` ingest already has its application (the pipeline created it when
// the AI proposal cleared the confidence threshold) — resolving one is a *confirm*:
// persist any chosen lookups and mark the ingest complete, no second application.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests, fieldMappings } from '../../../drizzle/schema'
import {
  buildCanonicalInput,
  computeResponses,
  resolvedFromMapping,
  resolvedMapFor,
} from './assemble'
import {
  createApplicationFromCanonical,
  fetchRoundProgrammeForApplication,
  findActiveRoundProgrammeByName,
} from '../applications/create'
import { CreateApplicationSchema } from '../../lib/validators/application'
import type { ResolveInput } from '../../lib/validators/ingest'

export type ResolveResult =
  | { ok: false; error: 'not_found' | 'already_resolved' | 'processing' | 'round_programme_missing' }
  | { ok: false; error: 'invalid'; fields: Array<{ field: string; message: string }> }
  | { ok: true; applicationId: string }

/** Persist reviewer-confirmed mappings to the foundation's lookup table. */
async function persistLookups(clientId: string, input: ResolveInput, actor: string | null) {
  for (const canonical of input.addToLookup) {
    const sourceKey = input.mapping[canonical]
    if (!sourceKey) continue
    await getDb()
      .insert(fieldMappings)
      .values({
        clientId,
        sourceKey,
        canonicalField: canonical,
        addedBy: actor,
      })
      .onConflictDoUpdate({
        target: [fieldMappings.clientId, fieldMappings.sourceKey],
        set: { canonicalField: canonical, addedBy: actor },
      })
  }
}

export async function resolveIngest(
  ingestId: string,
  input: ResolveInput,
  actor: string | null,
): Promise<ResolveResult> {
  const ingest = await getDb().query.applicationIngests.findFirst({
    where: eq(applicationIngests.id, ingestId),
  })
  if (!ingest) return { ok: false, error: 'not_found' }
  // The background pipeline hasn't finished with this row yet — resolving now
  // would race it into a duplicate application.
  if (ingest.status === 'received') return { ok: false, error: 'processing' }

  // Already promoted: confirm rather than re-create. The stored `resolved` map
  // stays as-is — it records what the pipeline actually applied to the application.
  if (ingest.applicationId) {
    if (ingest.status === 'complete') return { ok: false, error: 'already_resolved' }
    await persistLookups(ingest.clientId, input, actor)
    await getDb()
      .update(applicationIngests)
      .set({ status: 'complete', resolvedAt: new Date(), resolvedBy: actor })
      .where(eq(applicationIngests.id, ingestId))
    return { ok: true, applicationId: ingest.applicationId }
  }

  const payload = ingest.rawPayload
  const resolved = resolvedFromMapping(payload, input.mapping)

  // Resolve round programme: use the stored ID if we have it; otherwise derive it
  // from the programme name the reviewer supplied in their mapping.
  let roundProgrammeId = ingest.roundProgrammeId
  if (!roundProgrammeId) {
    const programmeName = resolved.programmeName?.value ?? null
    if (!programmeName) return { ok: false, error: 'round_programme_missing' }
    const found = await findActiveRoundProgrammeByName(ingest.clientId, programmeName)
    if (!found) return { ok: false, error: 'round_programme_missing' }
    roundProgrammeId = found.id
  }

  const roundProgramme =
    await fetchRoundProgrammeForApplication(roundProgrammeId)
  if (!roundProgramme) return { ok: false, error: 'round_programme_missing' }

  const responses = computeResponses(payload, resolved)
  const candidate = buildCanonicalInput(roundProgrammeId, resolved, responses)

  const parsed = CreateApplicationSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    }
  }

  // Persist confirmed mappings to the foundation's lookup table.
  await persistLookups(ingest.clientId, input, actor)

  const created = await createApplicationFromCanonical(roundProgramme, parsed.data)
  const applicationId = created.application?.id
  if (!applicationId) return { ok: false, error: 'round_programme_missing' }

  await getDb()
    .update(applicationIngests)
    .set({
      status: 'complete',
      applicationId,
      roundProgrammeId,
      resolved: resolvedMapFor(resolved),
      resolvedAt: new Date(),
      resolvedBy: actor,
    })
    .where(eq(applicationIngests.id, ingestId))

  return { ok: true, applicationId }
}
