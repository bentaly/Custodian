// ─── Canonical assembly helpers ──────────────────────────────────────────────
//
// Pure helpers shared by the ingest orchestrator and the admin resolve endpoint:
// turn a resolved canonical map + raw payload into a CreateApplicationInput
// candidate (validated by the caller) plus the leftover `responses`.

import { CreateApplicationSchema } from '../../lib/validators/application'
import {
  CANONICAL_FIELD_BY_KEY,
  CANONICAL_KEYS,
  toStringValue,
  type CanonicalFieldKey,
  type LookupResult,
} from '../../lib/fieldMapping'
import { parseBudgetBreakdown } from '../../lib/budget'
import { inviteRefKey } from '../../lib/sourcing/inviteRef'

const CANONICAL_KEY_SET = new Set<string>(CANONICAL_KEYS)

/** Marker sourceKey for a value supplied directly (not from a payload field). */
export const PROVIDED = '(provided)'

type Resolved = LookupResult['resolved']

/**
 * The payload's keys in the order the sender wrote them.
 *
 * `Object.keys` on a payload read back from the database is NOT that order — jsonb
 * normalises object keys (length, then bytewise), so a form's questions come back
 * shortest-first. `fieldOrder` is the order captured at `saveIngest`, before the
 * write; this reconciles the two, tolerating drift in either direction rather than
 * trusting the stored list blindly: keys named in the order but absent from the
 * payload are dropped, and keys in the payload the order never mentioned are kept
 * (appended, in whatever order they came back in). A missing or empty `fieldOrder`
 * — every row promoted before the column existed — leaves the payload's own order
 * untouched, which is the status quo rather than a guess.
 */
export function orderedKeys(
  payload: Record<string, unknown>,
  fieldOrder?: string[] | null,
): string[] {
  const present = Object.keys(payload)
  if (!fieldOrder || fieldOrder.length === 0) return present
  const presentSet = new Set(present)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const key of fieldOrder) {
    if (!presentSet.has(key) || seen.has(key)) continue
    seen.add(key)
    ordered.push(key)
  }
  for (const key of present) if (!seen.has(key)) ordered.push(key)
  return ordered
}

/** Payload entries not consumed as a mapped source and not a canonical key → responses. */
export function computeResponses(
  payload: Record<string, unknown>,
  resolved: Resolved,
  fieldOrder?: string[] | null,
): Array<{ label: string; value: string }> {
  const used = new Set(
    Object.values(resolved)
      .map((r) => r?.sourceKey)
      .filter((k): k is string => Boolean(k) && k !== PROVIDED),
  )
  // The invitation reference is plumbing the form handed back, not something the
  // applicant said (`lib/sourcing/inviteRef.ts`), so it is not one of their answers.
  const refKey = inviteRefKey(payload)
  return orderedKeys(payload, fieldOrder)
    .filter((k) => !used.has(k) && !CANONICAL_KEY_SET.has(k) && k !== refKey)
    .map((k) => ({ label: k, value: toStringValue(payload[k]) }))
    .filter((r) => r.value)
}

/**
 * The submission's running order, as an index of `{ incoming label → canonical field }`.
 *
 * This is what lets the "View submission" dialog show the form the way it was filled
 * in, instead of the shape our pipeline pulled it into: the applicant's own wording,
 * their own sequence, with the fields we recognised sitting where they actually asked
 * them rather than hoisted into a "details" card at the top.
 *
 * No values — see the column comment. Empty values are dropped for the same reason
 * `computeResponses` drops them: a field nobody answered is not part of the submission.
 */
export function buildSubmittedFields(
  payload: Record<string, unknown>,
  resolved: Resolved,
  fieldOrder?: string[] | null,
): Array<{ label: string; canonical: string | null }> {
  const canonicalBySourceKey = new Map<string, string>()
  for (const [canonical, r] of Object.entries(resolved)) {
    if (r && r.sourceKey !== PROVIDED) canonicalBySourceKey.set(r.sourceKey, canonical)
  }
  return orderedKeys(payload, fieldOrder)
    .filter((k) => toStringValue(payload[k]) !== '')
    .map((k) => ({
      label: k,
      // A payload that named a field by its canonical key resolves on the key alone
      // (`applyLookupOver`'s identity match), so it is canonical even where nothing
      // pointed at it — otherwise such a field would be indexed as a plain response
      // and then found to have no value, and would vanish from the dialog.
      canonical: canonicalBySourceKey.get(k) ?? (CANONICAL_KEY_SET.has(k) ? k : null),
    }))
}

/** Build a CreateApplicationInput candidate (unvalidated) from resolved fields. */
export function buildCanonicalInput(
  roundProgrammeId: string,
  resolved: Resolved,
  responses: Array<{ label: string; value: string }>,
  submittedFields?: Array<{ label: string; canonical: string | null }>,
) {
  const get = (k: CanonicalFieldKey) => resolved[k]?.value
  // A reading of '' is "could not read", and must stay undefined. `Number('')` is 0, so
  // passing it through turned an unreadable ask into £0 (then refused, holding the whole
  // submission) and an unreadable reserves or impact answer into a stored 0.
  const numberOf = (k: CanonicalFieldKey) => {
    const raw = get(k)
    if (raw == null) return undefined
    const read = CANONICAL_FIELD_BY_KEY[k].coerce!(raw)
    return read === '' ? undefined : Number(read)
  }
  const amount = numberOf('amountRequested')

  const impactCoerced = numberOf('proposedImpactQuantity')
  // Only pass a finite, non-negative number through; a garbled value stays unmapped.
  const proposedImpactQuantity =
    impactCoerced != null && Number.isFinite(impactCoerced) && impactCoerced >= 0
      ? impactCoerced
      : undefined

  // Reserves are read the same way, and for the same reason: `coerceAmount` strips the
  // pound sign and separators a form's own "(£)" field arrives with, and anything that
  // does not come out a finite non-negative number is left unmapped rather than written
  // as NaN. A negative figure is refused too — a charity in deficit exists, but so does
  // a form where somebody typed a minus into the wrong box, and the column is read as
  // "what they hold".
  const reservesCoerced = numberOf('unrestrictedReserves')
  const unrestrictedReserves =
    reservesCoerced != null && Number.isFinite(reservesCoerced) && reservesCoerced >= 0
      ? reservesCoerced
      : undefined

  // Income, read exactly as reserves are: one non-negative figure or nothing.
  const incomeCoerced = numberOf('organisationIncome')
  const organisationIncome =
    incomeCoerced != null && Number.isFinite(incomeCoerced) && incomeCoerced >= 0
      ? incomeCoerced
      : undefined

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
    organisationSummary: get('organisationSummary'),
    applicantEmail: get('applicantEmail'),
    charityNumber: get('charityNumber'),
    companyNumber: get('companyNumber'),
    deliveryArea: get('deliveryArea'),
    bankName: get('bankName'),
    bankAccountName: get('bankAccountName'),
    bankAccountNumber: get('bankAccountNumber'),
    bankSortCode: get('bankSortCode'),
    amountRequested: amount,
    unrestrictedReserves,
    organisationIncome,
    proposedImpactQuantity,
    budgetBreakdown: budgetBreakdown ?? undefined,
    budgetBreakdownLink: get('budgetBreakdownLink'),
    responses: allResponses,
    submittedFields,
  }
}

/**
 * Build a resolved map from an admin-supplied `canonicalField → sourceKey` mapping,
 * plus any `canonicalField → value` the reviewer typed by hand.
 *
 * A typed value WINS over the mapped source key, and is marked `PROVIDED` so it is
 * neither taught to the lookup table (a lookup is a source key, and this has none) nor
 * counted as consuming a payload field — which is what leaves the incoming answer it
 * replaces on the application as a response rather than dropping it.
 */
export function resolvedFromMapping(
  payload: Record<string, unknown>,
  mapping: Record<string, string>,
  values: Record<string, string> = {},
): Resolved {
  const resolved: Resolved = {}
  for (const [canonical, sourceKey] of Object.entries(mapping)) {
    if (!CANONICAL_KEY_SET.has(canonical)) continue
    const value = toStringValue(payload[sourceKey])
    if (value) resolved[canonical as CanonicalFieldKey] = { sourceKey, value }
  }
  for (const [canonical, raw] of Object.entries(values)) {
    if (!CANONICAL_KEY_SET.has(canonical)) continue
    const value = raw.trim()
    if (value) resolved[canonical as CanonicalFieldKey] = { sourceKey: PROVIDED, value }
  }
  return resolved
}

/** The typed values that survived (non-empty, a real canonical key), for storage. */
export function providedValuesFor(values: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [canonical, raw] of Object.entries(values)) {
    if (!CANONICAL_KEY_SET.has(canonical)) continue
    const value = raw.trim()
    if (value) kept[canonical] = value
  }
  return kept
}

/** Storage form: `sourceKey → canonicalField` (skips directly-provided values). */
export function resolvedMapFor(resolved: Resolved): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [canonical, r] of Object.entries(resolved)) {
    if (r && r.sourceKey !== PROVIDED) m[r.sourceKey] = canonical
  }
  return m
}

/**
 * Assemble and validate an application, landing it WITHOUT any optional or expected
 * value that fails validation rather than holding the whole submission for it.
 *
 * Until 2026-09-29 one bad value anywhere held everything: a delivery area answered in
 * 863 characters, a sort code with a note after it, an email typed as "grants at …".
 * That was right while only we could fix a submission, and wrong once the foundation
 * could (applications are editable in Custodian). Now such a value is left off the
 * application, the answer stays in the submission, and the application screen's "Not
 * captured" panel says it was SENT but could not be read, which is a different thing
 * from never asked and is worded differently.
 *
 * A REQUIRED field failing still fails: without the programme or the reference there is
 * no application to land. `unreadable` names what was left off.
 */
export function assembleApplication(
  roundProgrammeId: string,
  resolved: Resolved,
  responses: Array<{ label: string; value: string }>,
  submittedFields?: Array<{ label: string; canonical: string | null }>,
): {
  parsed: ReturnType<typeof CreateApplicationSchema.safeParse>
  unreadable: CanonicalFieldKey[]
} {
  const candidate: Record<string, unknown> = buildCanonicalInput(
    roundProgrammeId,
    resolved,
    responses,
    submittedFields,
  )
  const first = CreateApplicationSchema.safeParse(candidate)
  if (first.success) return { parsed: first, unreadable: [] }

  const failing = [...new Set(first.error.issues.map((i) => String(i.path[0] ?? '')))]
  const droppable = failing.filter(
    (k): k is CanonicalFieldKey =>
      CANONICAL_KEY_SET.has(k) &&
      CANONICAL_FIELD_BY_KEY[k as CanonicalFieldKey].tier !== 'required',
  )
  if (droppable.length !== failing.length) return { parsed: first, unreadable: [] }
  for (const k of droppable) candidate[k] = undefined
  return { parsed: CreateApplicationSchema.safeParse(candidate), unreadable: droppable }
}
