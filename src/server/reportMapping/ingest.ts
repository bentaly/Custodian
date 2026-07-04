// ─── Report ingest orchestrator ──────────────────────────────────────────────
//
// Turns a raw grant-report payload into either a real report submission (when
// every required canonical field resolves AND the externalApplicationId matches
// exactly one grant) or a held `report_ingests` row for human review. Mirrors
// fieldMapping/ingest.ts:
//   saveReportIngest    — persist the raw payload as `received`; route 202s after.
//   processReportIngest — background pipeline: lookup (formType='report') →
//                         common report dictionary → AI fallback for unresolved
//                         required fields → exact-ID grant match → validate →
//                         promote (create submission + tick milestone + AI
//                         analysis) or hold with ranked grant candidates.
//
// Matching is deliberately binary at this layer: the external ID either
// identifies exactly one grant or the report is held. The heuristic candidates
// stored on held rows are advisory — a human confirms one in the review queue.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { fieldMappings, reportIngests } from '../../../drizzle/schema'
import {
  applyLookupOver,
  matchCommonReportKey,
  toStringValue,
  REPORT_CANONICAL_FIELD_BY_KEY,
  REPORT_CANONICAL_KEYS,
  REQUIRED_REPORT_CANONICAL_KEYS,
} from '../../lib/fieldMapping'
import type { FieldProposal } from '../../lib/fieldMapping/types'
import { runFieldMapping, type FieldMappingAssessor } from '../fieldMapping/run'
import {
  buildReportCanonicalInput,
  computeReportResponses,
  reportResolvedMapFor,
  type ReportResolved,
} from './assemble'
import { computeGrantCandidates, findGrantByExternalApplicationId } from './match'
import { createReportSubmissionFromCanonical, fetchGrantForReport } from '../reports/create'
import { CreateReportSubmissionSchema } from '../../lib/validators/report'

const AI_CONFIDENCE_THRESHOLD = 0.85
const REPORT_KEY_SET = new Set<string>(REPORT_CANONICAL_KEYS)

export type ReportIngestStatus = 'complete' | 'ai_proposed' | 'needs_review'

/** Persist the raw payload immediately, before any processing can fail. */
export async function saveReportIngest(params: {
  clientId: string
  payload: Record<string, unknown>
}): Promise<string> {
  const [ingest] = await getDb()
    .insert(reportIngests)
    .values({
      clientId: params.clientId,
      rawPayload: params.payload,
      status: 'received',
    })
    .returning({ id: reportIngests.id })
  return ingest!.id
}

export type ProcessReportIngestResult =
  | { ok: false; error: 'not_found' | 'not_received' }
  | { ok: true; status: ReportIngestStatus; reportSubmissionId: string | null }

export async function processReportIngest(
  ingestId: string,
  opts: { assess?: FieldMappingAssessor } = {},
): Promise<ProcessReportIngestResult> {
  const ingest = await getDb().query.reportIngests.findFirst({
    where: eq(reportIngests.id, ingestId),
  })
  if (!ingest) return { ok: false, error: 'not_found' }
  if (ingest.status !== 'received') return { ok: false, error: 'not_received' }

  const { clientId, rawPayload: payload } = ingest

  // 1. Lookup-table match (report vocabulary only).
  const mappings = await getDb().query.fieldMappings.findMany({
    where: and(eq(fieldMappings.clientId, clientId), eq(fieldMappings.formType, 'report')),
    columns: { sourceKey: true, canonicalField: true },
  })
  const lookup = applyLookupOver(
    payload,
    mappings,
    REPORT_CANONICAL_KEYS,
    REQUIRED_REPORT_CANONICAL_KEYS,
  )
  const resolved: ReportResolved = { ...lookup.resolved }

  // 2. Built-in common report dictionary (curated, certain aliases — same
  //    standing as a lookup hit; the client's own table ran first and wins).
  const commonConsumed = new Set<string>()
  for (const key of lookup.leftoverKeys) {
    const canonical = matchCommonReportKey(key)
    if (!canonical || resolved[canonical]) continue
    const value = toStringValue(payload[key])
    if (!value) continue
    resolved[canonical] = { sourceKey: key, value }
    commonConsumed.add(key)
  }

  // 3. AI fallback for any required field still unresolved.
  let unresolvedRequired = REQUIRED_REPORT_CANONICAL_KEYS.filter((k) => !resolved[k])
  let aiUsed = false
  let proposed: Record<string, FieldProposal> | null = null

  if (unresolvedRequired.length > 0) {
    const proposals = await runFieldMapping(
      {
        fields: unresolvedRequired.map((k) => {
          const f = REPORT_CANONICAL_FIELD_BY_KEY[k]
          return { key: f.key, label: f.label, description: f.description }
        }),
        payload: lookup.leftoverKeys
          .filter((k) => !commonConsumed.has(k))
          .map((k) => ({ key: k, value: toStringValue(payload[k]) })),
      },
      { assess: opts.assess, allowedKeys: REPORT_KEY_SET, formKind: 'grant report' },
    )
    proposed = proposals

    for (const key of unresolvedRequired) {
      const p = proposals[key]
      if (!p || !p.sourceKey || p.confidence <= AI_CONFIDENCE_THRESHOLD) continue
      const value = toStringValue(payload[p.sourceKey])
      if (!value) continue
      resolved[key] = { sourceKey: p.sourceKey, value }
      aiUsed = true
    }
    unresolvedRequired = REQUIRED_REPORT_CANONICAL_KEYS.filter((k) => !resolved[k])
  }

  // 4. Grant matching — the only automated path is an exact external-ID match to
  //    exactly one grant. Anything else holds the report with ranked candidates.
  const externalId = resolved.externalApplicationId?.value ?? null
  let grantId: string | null = null
  if (externalId) {
    const match = await findGrantByExternalApplicationId(clientId, externalId)
    if (match.kind === 'matched') grantId = match.grantId
  }

  // 5. Assemble + validate.
  const responses = computeReportResponses(payload, resolved)
  const resolvedMap = reportResolvedMapFor(resolved)
  const candidate = buildReportCanonicalInput(resolved, responses)
  const parsed = CreateReportSubmissionSchema.safeParse(candidate)

  // 6. Decide status. Both gates must pass: fields resolved+valid AND a grant.
  const status: ReportIngestStatus =
    unresolvedRequired.length === 0 && parsed.success && grantId
      ? aiUsed
        ? 'ai_proposed'
        : 'complete'
      : 'needs_review'

  // 7. Promote, or hold with advisory candidates for the review queue.
  let reportSubmissionId: string | null = null
  let matchCandidates: Awaited<ReturnType<typeof computeGrantCandidates>> | null = null

  if (status !== 'needs_review' && parsed.success && grantId) {
    const grant = await fetchGrantForReport(grantId)
    if (grant) {
      const created = await createReportSubmissionFromCanonical(grant, parsed.data, 'external_id')
      reportSubmissionId = created.submission?.id ?? null
    }
  }
  if (!reportSubmissionId) {
    matchCandidates = await computeGrantCandidates(clientId, {
      charityNumber: resolved.charityNumber?.value,
      organisationName: resolved.organisationName?.value,
      programmeName: resolved.programmeName?.value,
      amountAwarded: parsed.success ? (parsed.data.amountAwarded ?? null) : null,
      awardDate: resolved.awardDate?.value,
    })
  }

  const finalStatus: ReportIngestStatus = reportSubmissionId ? status : 'needs_review'
  await getDb()
    .update(reportIngests)
    .set({
      status: finalStatus,
      proposed,
      resolved: resolvedMap,
      matchCandidates,
      reportSubmissionId,
      resolvedAt: finalStatus === 'needs_review' ? null : new Date(),
    })
    .where(eq(reportIngests.id, ingestId))

  return { ok: true, status: finalStatus, reportSubmissionId }
}
