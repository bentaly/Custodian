// ─── Admin resolve (report ingests) ──────────────────────────────────────────
//
// A reviewer completes a held report ingest: their `canonicalField → sourceKey`
// mapping is validated, they pick the grant the report belongs to (usually one
// of the stored heuristic candidates), the submission is created with
// matchMethod 'manual', lookups they flagged are persisted with formType
// 'report', and the ingest is marked complete. Mirrors fieldMapping/resolve.ts.
//
// An `ai_proposed` ingest already has its submission (the pipeline created it on
// an exact external-ID match) — resolving one is a *confirm*: persist chosen
// lookups and mark complete, no second submission.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { fieldMappings, awards, reportIngests } from '../../../drizzle/schema'
import {
  buildReportCanonicalInput,
  computeReportResponses,
  reportResolvedMapFor,
  resolvedFromReportMapping,
} from './assemble'
import { createReportSubmissionFromCanonical, fetchGrantForReport } from '../reports/create'
import { CreateReportSubmissionSchema } from '../../lib/validators/report'
import type { ResolveReportInput } from '../../lib/validators/ingest'

export type ResolveReportResult =
  | { ok: false; error: 'not_found' | 'already_resolved' | 'processing' | 'grant_not_found' }
  | { ok: false; error: 'invalid'; fields: Array<{ field: string; message: string }> }
  | { ok: true; reportId: string }

async function persistReportLookups(
  clientId: string,
  input: ResolveReportInput,
  actor: string | null,
) {
  for (const canonical of input.addToLookup) {
    const sourceKey = input.mapping[canonical]
    if (!sourceKey) continue
    await getDb()
      .insert(fieldMappings)
      .values({
        clientId,
        sourceKey,
        canonicalField: canonical,
        formType: 'report',
        addedBy: actor,
      })
      .onConflictDoUpdate({
        target: [fieldMappings.clientId, fieldMappings.formType, fieldMappings.sourceKey],
        set: { canonicalField: canonical, addedBy: actor },
      })
  }
}

export async function resolveReportIngest(
  ingestId: string,
  input: ResolveReportInput,
  actor: string | null,
): Promise<ResolveReportResult> {
  const ingest = await getDb().query.reportIngests.findFirst({
    where: eq(reportIngests.id, ingestId),
  })
  if (!ingest) return { ok: false, error: 'not_found' }
  // The background pipeline hasn't finished with this row yet — resolving now
  // would race it into a duplicate submission.
  if (ingest.status === 'received') return { ok: false, error: 'processing' }

  // Already promoted: confirm rather than re-create.
  if (ingest.reportId) {
    if (ingest.status === 'complete') return { ok: false, error: 'already_resolved' }
    await persistReportLookups(ingest.clientId, input, actor)
    await getDb()
      .update(reportIngests)
      .set({ status: 'complete', resolvedAt: new Date(), resolvedBy: actor })
      .where(eq(reportIngests.id, ingestId))
    return { ok: true, reportId: ingest.reportId }
  }

  // Creating the submission needs a grant. It must exist and belong to the
  // ingest's client — never allow a reviewer to stitch a report onto another
  // tenant's grant.
  if (!input.awardId) return { ok: false, error: 'grant_not_found' }
  const grantRow = await getDb().query.awards.findFirst({
    where: eq(awards.id, input.awardId),
    columns: { id: true, clientId: true },
  })
  if (!grantRow || grantRow.clientId !== ingest.clientId) {
    return { ok: false, error: 'grant_not_found' }
  }

  const payload = ingest.rawPayload
  const resolved = resolvedFromReportMapping(payload, input.mapping)
  const responses = computeReportResponses(payload, resolved)
  const candidate = buildReportCanonicalInput(resolved, responses)

  const parsed = CreateReportSubmissionSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    }
  }

  await persistReportLookups(ingest.clientId, input, actor)

  const grant = await fetchGrantForReport(input.awardId)
  if (!grant) return { ok: false, error: 'grant_not_found' }
  const created = await createReportSubmissionFromCanonical(grant, parsed.data, 'manual')
  const reportId = created.submission?.id
  if (!reportId) return { ok: false, error: 'grant_not_found' }

  await getDb()
    .update(reportIngests)
    .set({
      status: 'complete',
      reportId,
      resolved: reportResolvedMapFor(resolved),
      resolvedAt: new Date(),
      resolvedBy: actor,
    })
    .where(eq(reportIngests.id, ingestId))

  return { ok: true, reportId }
}
