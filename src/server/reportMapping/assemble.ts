// ─── Report canonical assembly helpers ───────────────────────────────────────
//
// Pure helpers shared by the report ingest orchestrator and the admin resolve
// endpoint. Mirrors fieldMapping/assemble.ts over the report vocabulary.

import {
  REPORT_CANONICAL_FIELD_BY_KEY,
  REPORT_CANONICAL_KEYS,
  toStringValue,
  type ReportCanonicalFieldKey,
} from '../../lib/fieldMapping'
import type { ResolvedField } from '../../lib/fieldMapping/types'
import { PROVIDED } from '../fieldMapping/assemble'

const REPORT_KEY_SET = new Set<string>(REPORT_CANONICAL_KEYS)

export type ReportResolved = Partial<Record<ReportCanonicalFieldKey, ResolvedField>>

/** Payload entries not consumed as a mapped source and not a canonical key → responses. */
export function computeReportResponses(
  payload: Record<string, unknown>,
  resolved: ReportResolved,
): Array<{ label: string; value: string }> {
  const used = new Set(
    Object.values(resolved)
      .map((r) => r?.sourceKey)
      .filter((k): k is string => Boolean(k) && k !== PROVIDED),
  )
  return Object.entries(payload)
    .filter(([k]) => !used.has(k) && !REPORT_KEY_SET.has(k))
    .map(([k, v]) => ({ label: k, value: toStringValue(v) }))
    .filter((r) => r.value)
}

/** Build a CreateReportSubmissionInput candidate (unvalidated) from resolved fields. */
export function buildReportCanonicalInput(
  resolved: ReportResolved,
  responses: Array<{ label: string; value: string }>,
) {
  const get = (k: ReportCanonicalFieldKey) => resolved[k]?.value
  const amountRaw = get('amountAwarded')
  const amount = amountRaw
    ? Number(REPORT_CANONICAL_FIELD_BY_KEY.amountAwarded.coerce!(amountRaw))
    : undefined
  const countRaw = get('beneficiaryCount')
  const countCoerced = countRaw
    ? REPORT_CANONICAL_FIELD_BY_KEY.beneficiaryCount.coerce!(countRaw)
    : ''
  const count = countCoerced ? Number(countCoerced) : undefined

  return {
    externalApplicationId: get('externalApplicationId'),
    organisationName: get('organisationName'),
    impactSummary: get('impactSummary'),
    charityNumber: get('charityNumber'),
    companyNumber: get('companyNumber'),
    programmeName: get('programmeName'),
    amountAwarded: amount !== undefined && Number.isFinite(amount) && amount > 0 ? amount : undefined,
    awardDate: get('awardDate'),
    awardEndDate: get('awardEndDate'),
    contactName: get('contactName'),
    contactEmail: get('contactEmail'),
    contactPhone: get('contactPhone'),
    grantTitle: get('grantTitle'),
    grantPurpose: get('grantPurpose'),
    challenges: get('challenges'),
    lessons: get('lessons'),
    caseStudies: get('caseStudies'),
    testimonials: get('testimonials'),
    otherComments: get('otherComments'),
    beneficiaryCount: count !== undefined && Number.isFinite(count) ? count : undefined,
    deliveryArea: get('deliveryArea'),
    responses,
  }
}

/** Build a resolved map from an admin-supplied `canonicalField → sourceKey` mapping. */
export function resolvedFromReportMapping(
  payload: Record<string, unknown>,
  mapping: Record<string, string>,
): ReportResolved {
  const resolved: ReportResolved = {}
  for (const [canonical, sourceKey] of Object.entries(mapping)) {
    if (!REPORT_KEY_SET.has(canonical)) continue
    const value = toStringValue(payload[sourceKey])
    if (value) resolved[canonical as ReportCanonicalFieldKey] = { sourceKey, value }
  }
  return resolved
}

/** Storage form: `sourceKey → canonicalField` (skips directly-provided values). */
export function reportResolvedMapFor(resolved: ReportResolved): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [canonical, r] of Object.entries(resolved)) {
    if (r && r.sourceKey !== PROVIDED) m[r.sourceKey] = canonical
  }
  return m
}
