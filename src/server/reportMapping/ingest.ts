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
// Matching is deliberately binary at this layer: the external ID (or, failing it,
// the charity number, see match.ts) either
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
import {
  computeGrantCandidates,
  findGrantByCharityNumber,
  findGrantByExternalApplicationId,
} from './match'
import { createReportSubmissionFromCanonical, fetchGrantForReport } from '../reports/create'
import { CreateReportSubmissionSchema } from '../../lib/validators/report'
import { reportFault } from '../faults'
import { earlierIdenticalReport, resentNote } from '../ingestDedupe'

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
      // Read here, before jsonb reorders it, so View Report can list the answers as sent.
      fieldOrder: Object.keys(params.payload),
      status: 'received',
    })
    .returning({ id: reportIngests.id })
  return ingest!.id
}

export type ProcessReportIngestResult =
  | { ok: false; error: 'not_found' | 'not_received' }
  | { ok: true; status: ReportIngestStatus; reportId: string | null }

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

  // 0. An exact re-send creates nothing: without this a retried report became a second
  //    report and ticked the NEXT reporting milestone too. See `ingestDedupe.ts`.
  const earlier = await earlierIdenticalReport(ingest)
  if (earlier) {
    await getDb()
      .update(reportIngests)
      .set({ status: 'complete', note: resentNote(earlier), resolvedAt: new Date() })
      .where(eq(reportIngests.id, ingestId))
    return { ok: true, status: 'complete', reportId: null }
  }

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

  // 4. Grant matching. Two automated paths, both exact: the foundation's reference to
  //    exactly one grant, and failing that (no reference, or one we do not know) the
  //    charity number to the one grant still waiting on a report. A reference that
  //    names SEVERAL grants is a conflict to look at, not a gap to fill, so it does
  //    not fall through. Anything else holds the report with ranked candidates.
  const externalId = resolved.externalApplicationId?.value ?? null
  let grantId: string | null = null
  let matchMethod: 'external_id' | 'charity_number' = 'external_id'
  let ambiguousReference = false
  if (externalId) {
    const match = await findGrantByExternalApplicationId(clientId, externalId)
    if (match.kind === 'matched') grantId = match.awardId
    ambiguousReference = match.kind === 'ambiguous'
  }
  const charityNumber = resolved.charityNumber?.value ?? null
  if (!grantId && !ambiguousReference && charityNumber) {
    grantId = await findGrantByCharityNumber(clientId, charityNumber, resolved.programmeName?.value)
    if (grantId) matchMethod = 'charity_number'
  }

  // 5. Assemble + validate.
  const responses = computeReportResponses(payload, resolved)
  const resolvedMap = reportResolvedMapFor(resolved)
  const candidate = buildReportCanonicalInput(resolved, responses)
  const parsed = CreateReportSubmissionSchema.safeParse(candidate)

  // 6. Decide status. Two gates: the values read (`parsed`) AND a grant. A required
  //    field the mappers could not find no longer holds a report (the name comes from
  //    the grant, the analysis reads the rest), and a report with no grant match waits
  //    on the Reports screen for the foundation to pick one (`fns/heldReports.ts`).
  //    `unresolvedRequired` still drives the AI fallback above.
  void unresolvedRequired
  const status: ReportIngestStatus =
    parsed.success && grantId ? (aiUsed ? 'ai_proposed' : 'complete') : 'needs_review'

  // 7. Promote, or hold with advisory candidates for the review queue.
  let reportId: string | null = null
  let matchCandidates: Awaited<ReturnType<typeof computeGrantCandidates>> | null = null

  if (status !== 'needs_review' && parsed.success && grantId) {
    const grant = await fetchGrantForReport(grantId)
    if (grant) {
      const created = await createReportSubmissionFromCanonical(grant, parsed.data, matchMethod, {
        receivedAt: ingest.createdAt,
      })
      reportId = created.submission?.id ?? null
    }
  }
  if (!reportId) {
    matchCandidates = await computeGrantCandidates(clientId, {
      charityNumber: resolved.charityNumber?.value,
      organisationName: resolved.organisationName?.value,
      programmeName: resolved.programmeName?.value,
    })
  }

  const finalStatus: ReportIngestStatus = reportId ? status : 'needs_review'
  await getDb()
    .update(reportIngests)
    .set({
      status: finalStatus,
      proposed,
      resolved: resolvedMap,
      matchCandidates,
      reportId,
      resolvedAt: finalStatus === 'needs_review' ? null : new Date(),
    })
    .where(eq(reportIngests.id, ingestId))

  // Held for US (values that cannot be read), as opposed to waiting for the foundation
  // to pick a grant, which is routine and shown on their Reports screen. Only the
  // first is worth an email; fingerprinted per report so each is a new Sentry issue.
  if (finalStatus === 'needs_review' && !parsed.success) {
    reportFault(
      'report-held',
      new Error('Submission held for review (report)'),
      { ingestId, clientId, invalid: parsed.error.issues.map((i) => i.path.join('.')) },
      ['report-held', ingestId],
    )
  }

  return { ok: true, status: finalStatus, reportId }
}
