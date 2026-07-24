// ─── Canonical assembly helpers ──────────────────────────────────────────────
//
// Pure helpers shared by the ingest orchestrator and the admin resolve endpoint:
// turn a resolved canonical map + raw payload into a CreateApplicationInput
// candidate (validated by the caller) plus the leftover `responses`.

import {
  CANONICAL_FIELD_BY_KEY,
  CANONICAL_KEYS,
  toStringValue,
  type CanonicalFieldKey,
  type LookupResult,
} from '../../lib/fieldMapping'
import { parseBudgetBreakdown } from '../../lib/budget'

const CANONICAL_KEY_SET = new Set<string>(CANONICAL_KEYS)

/** Marker sourceKey for a value supplied directly (not from a payload field). */
export const PROVIDED = '(provided)'

type Resolved = LookupResult['resolved']

/** Payload entries not consumed as a mapped source and not a canonical key → responses. */
export function computeResponses(
  payload: Record<string, unknown>,
  resolved: Resolved,
): Array<{ label: string; value: string }> {
  const used = new Set(
    Object.values(resolved)
      .map((r) => r?.sourceKey)
      .filter((k): k is string => Boolean(k) && k !== PROVIDED),
  )
  return Object.entries(payload)
    .filter(([k]) => !used.has(k) && !CANONICAL_KEY_SET.has(k))
    .map(([k, v]) => ({ label: k, value: toStringValue(v) }))
    .filter((r) => r.value)
}

/** Build a CreateApplicationInput candidate (unvalidated) from resolved fields. */
export function buildCanonicalInput(
  roundProgrammeId: string,
  resolved: Resolved,
  responses: Array<{ label: string; value: string }>,
) {
  const get = (k: CanonicalFieldKey) => resolved[k]?.value
  const amountRaw = get('amountRequested')
  const amount =
    amountRaw != null ? Number(CANONICAL_FIELD_BY_KEY.amountRequested.coerce!(amountRaw)) : undefined

  const impactRaw = get('proposedImpactQuantity')
  const impactCoerced =
    impactRaw != null ? Number(CANONICAL_FIELD_BY_KEY.proposedImpactQuantity.coerce!(impactRaw)) : undefined
  // Only pass a finite, non-negative number through; a garbled value stays unmapped.
  const proposedImpactQuantity =
    impactCoerced != null && Number.isFinite(impactCoerced) && impactCoerced >= 0 ? impactCoerced : undefined

  // The breakdown reaches us as a JSON string (`toStringValue` stringifies any
  // structured payload value). A value that isn't actually structured — a prose
  // budget narrative someone mapped here — must not be silently dropped: fall back
  // to keeping it as a response under its original field name.
  const budgetRaw = get('budgetBreakdown')
  const budgetBreakdown = budgetRaw != null ? parseBudgetBreakdown(budgetRaw) : null
  const allResponses =
    budgetRaw != null && budgetBreakdown === null
      ? [
          ...responses,
          {
            label:
              resolved.budgetBreakdown!.sourceKey === PROVIDED
                ? 'Budget breakdown'
                : resolved.budgetBreakdown!.sourceKey,
            value: budgetRaw,
          },
        ]
      : responses

  return {
    roundProgrammeId,
    externalApplicationId: get('externalApplicationId'),
    organisationName: get('organisationName'),
    applicantEmail: get('applicantEmail'),
    charityNumber: get('charityNumber'),
    companyNumber: get('companyNumber'),
    deliveryArea: get('deliveryArea'),
    bankName: get('bankName'),
    bankAccountName: get('bankAccountName'),
    bankAccountNumber: get('bankAccountNumber'),
    bankSortCode: get('bankSortCode'),
    amountRequested: amount,
    proposedImpactQuantity,
    budgetBreakdown: budgetBreakdown ?? undefined,
    responses: allResponses,
  }
}

/** Build a resolved map from an admin-supplied `canonicalField → sourceKey` mapping. */
export function resolvedFromMapping(
  payload: Record<string, unknown>,
  mapping: Record<string, string>,
): Resolved {
  const resolved: Resolved = {}
  for (const [canonical, sourceKey] of Object.entries(mapping)) {
    if (!CANONICAL_KEY_SET.has(canonical)) continue
    const value = toStringValue(payload[sourceKey])
    if (value) resolved[canonical as CanonicalFieldKey] = { sourceKey, value }
  }
  return resolved
}

/** Storage form: `sourceKey → canonicalField` (skips directly-provided values). */
export function resolvedMapFor(resolved: Resolved): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [canonical, r] of Object.entries(resolved)) {
    if (r && r.sourceKey !== PROVIDED) m[r.sourceKey] = canonical
  }
  return m
}
