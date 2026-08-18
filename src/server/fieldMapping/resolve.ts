// ─── Admin resolve ───────────────────────────────────────────────────────────
//
// A reviewer completes a held ingest: their `canonicalField → sourceKey` mapping
// is validated into a real application, the application is created, the ingest is
// marked complete, and any fields flagged `addToLookup` are persisted to the
// foundation's lookup table so the same source key resolves automatically next time.
//
// An `ai_proposed` ingest already has its application (the pipeline created it when
// the AI proposal cleared the confidence threshold) — resolving one is a *confirm*:
// no second application is created, but the reviewer's mapping is still applied to the
// existing one, because a confirm is also where a wrong AI mapping gets corrected.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests, awards, fieldMappings } from '../../../drizzle/schema'
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
  updateApplicationFromCanonical,
} from '../applications/create'
import { CreateApplicationSchema } from '../../lib/validators/application'
import { describeOneOfGroup, unmetOneOfGroups } from '../../lib/fieldMapping'
import type { ResolveInput } from '../../lib/validators/ingest'

export type ResolveResult =
  | {
      ok: false
      error:
        | 'not_found'
        | 'already_resolved'
        | 'already_awarded'
        | 'processing'
        | 'round_programme_missing'
    }
  | { ok: false; error: 'invalid'; fields: Array<{ field: string; message: string }> }
  | {
      ok: true
      applicationId: string
      /** Whether confirming actually changed the application's canonical fields. */
      updated?: boolean
      /** Derived features re-run because their inputs changed, for the UI to report. */
      rerun?: string[]
    }

/**
 * The required one-of groups a reviewer's mapping leaves unsatisfied, as validation
 * issues.
 *
 * The pipeline holds a submission that resolved no member of such a group; without the
 * same check here a reviewer could clear the queue by leaving the group blank and create
 * exactly the application the hold exists to prevent. Reported through the normal
 * `invalid` channel so the admin app renders it like any other field error.
 *
 * REQUIRED_ONE_OF_GROUPS is empty today, so this yields nothing — kept in step with
 * `ingest.ts` so a group added there is enforced on both paths at once.
 */
function oneOfIssues(mapping: ResolveInput['mapping']): Array<{ field: string; message: string }> {
  const chosen = Object.entries(mapping)
    .filter(([, sourceKey]) => sourceKey)
    .map(([canonical]) => canonical)
  return unmetOneOfGroups(chosen).map((group) => ({
    field: group[0]!,
    message: `Map a ${describeOneOfGroup(group)} — a submission needs at least one of them.`,
  }))
}

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
        formType: 'application',
        addedBy: actor,
      })
      .onConflictDoUpdate({
        target: [fieldMappings.clientId, fieldMappings.formType, fieldMappings.sourceKey],
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

  // Already promoted: confirm rather than re-create — but a confirm may also CORRECT
  // the mapping, and those corrections have to reach the application.
  //
  // This branch used to persist lookups and mark the ingest complete, keeping the
  // stored `resolved` map "as the pipeline applied it" and ignoring `input.mapping`
  // entirely. But the reviewer is looking at editable dropdowns above a Confirm
  // button: mapping the charity number the model missed, confirming, and finding the
  // application still holds NULL — still unscreenable, still `review` however many
  // times due diligence is re-run — is the mapping equivalent of a lost field. Being
  // able to fix what the pipeline got wrong is the entire point of this queue.
  if (ingest.applicationId) {
    // A `complete` ingest can still be re-confirmed, because a mapping mistake does not
    // stop being a mistake once the row is filed — and until this existed, the only way
    // to correct one was to delete the application and have the foundation resubmit.
    // The line is drawn at money: once a grant has been awarded against the application,
    // its charity number and amount are what the award letter was written from, so they
    // are no longer ours to rewrite underneath it.
    if (ingest.status === 'complete') {
      const grant = await getDb().query.awards.findFirst({
        where: eq(awards.applicationId, ingest.applicationId),
        columns: { id: true },
      })
      if (grant) return { ok: false, error: 'already_awarded' }
    }

    const roundProgrammeId = ingest.roundProgrammeId
    if (!roundProgrammeId) return { ok: false, error: 'round_programme_missing' }

    const confirmedResolved = resolvedFromMapping(ingest.rawPayload, input.mapping)
    const confirmedResponses = computeResponses(ingest.rawPayload, confirmedResolved)
    const confirmed = CreateApplicationSchema.safeParse(
      buildCanonicalInput(roundProgrammeId, confirmedResolved, confirmedResponses),
    )
    const confirmIssues = [
      ...(confirmed.success
        ? []
        : confirmed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))),
      ...oneOfIssues(input.mapping),
    ]
    // Refused rather than partially applied. This also guards the degenerate case of a
    // mapping arriving empty (the canonical registry not yet loaded in the client): it
    // fails on the required fields instead of blanking a live application.
    if (!confirmed.success || confirmIssues.length > 0) {
      return { ok: false, error: 'invalid', fields: confirmIssues }
    }

    const roundProgramme = await fetchRoundProgrammeForApplication(roundProgrammeId)
    if (!roundProgramme) return { ok: false, error: 'round_programme_missing' }

    await persistLookups(ingest.clientId, input, actor)
    const { rerun } = await updateApplicationFromCanonical(
      roundProgramme,
      ingest.applicationId,
      confirmed.data,
    )

    const confirmedMap = resolvedMapFor(confirmedResolved)
    const updated = JSON.stringify(confirmedMap) !== JSON.stringify(ingest.resolved ?? {})

    await getDb()
      .update(applicationIngests)
      // The stored map records what was actually applied — after a correction that is
      // the reviewer's mapping, not the model's proposal.
      .set({
        status: 'complete',
        resolved: confirmedMap,
        resolvedAt: new Date(),
        resolvedBy: actor,
      })
      .where(eq(applicationIngests.id, ingestId))

    return { ok: true, applicationId: ingest.applicationId, updated, rerun }
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

  const roundProgramme = await fetchRoundProgrammeForApplication(roundProgrammeId)
  if (!roundProgramme) return { ok: false, error: 'round_programme_missing' }

  const responses = computeResponses(payload, resolved)
  const candidate = buildCanonicalInput(roundProgrammeId, resolved, responses)

  const parsed = CreateApplicationSchema.safeParse(candidate)
  const issues = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))),
    ...oneOfIssues(input.mapping),
  ]
  if (!parsed.success || issues.length > 0) {
    return { ok: false, error: 'invalid', fields: issues }
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
