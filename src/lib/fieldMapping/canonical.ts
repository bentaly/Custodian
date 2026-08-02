// ─── Canonical field registry ───────────────────────────────────────────────
//
// The single source of truth for the application fields that incoming foundation
// payloads are mapped onto. Used by the lookup matcher, the AI fallback prompt,
// the admin review UI, and /settings/submissions (which publishes this registry as
// the spec a foundation builds against). Keys match `CreateApplicationSchema` /
// the `applications` columns. Everything not mapped here flows into `responses`.
//
// Each field carries a TIER, which is how much its absence costs:
//
//   required  — no application without it. Unresolved → the ingest is held for
//               human review.
//   one_of    — belongs to a group (see REQUIRED_ONE_OF_GROUPS) of which at least
//               one member must resolve. Individually optional, collectively not.
//   expected  — the application is created without it, but a feature is degraded,
//               so the absence is stated on the application rather than left silent.
//
// The middle tier exists because a two-state model (required / optional) cost us a
// real bug: `charityNumber` and `companyNumber` are each individually optional — an
// applicant may hold either — but an application with NEITHER can never be screened
// for due diligence. Marked plain optional, such a submission promoted quietly, the
// registry checks never ran, and nothing anywhere reported a problem. It is exactly
// the failure a required field is meant to prevent; it just doesn't fit on one field.
//
// `expected` answers the same problem for fields where holding the submission would
// be disproportionate: a foundation that doesn't ask for a delivery area shouldn't
// have every application stuck in a queue, but nor should the deprivation lookup
// silently never run. Promote, and say so.

export type CanonicalFieldKey =
  | 'programmeName'
  | 'externalApplicationId'
  | 'organisationName'
  | 'applicantEmail'
  | 'amountRequested'
  | 'bankName'
  | 'bankAccountName'
  | 'bankAccountNumber'
  | 'bankSortCode'
  | 'charityNumber'
  | 'companyNumber'
  | 'deliveryArea'
  | 'budgetBreakdown'
  | 'proposedImpactQuantity'

/** How much a field's absence costs. See the header for what each tier means. */
export type FieldTier = 'required' | 'one_of' | 'expected'

export interface CanonicalField {
  key: CanonicalFieldKey
  /** Human label shown in the review UI. */
  label: string
  /** What happens when this field doesn't resolve. */
  tier: FieldTier
  /** Guidance for the AI fallback and reviewers on what this field holds. */
  description: string
  /**
   * For `expected` fields: what stops working without it, phrased to be shown to an
   * admin on the application. Absent for tiers that block promotion, since those
   * never reach an application in the first place.
   */
  degrades?: string
  /** Optional transform from the raw (string) payload value to canonical form. */
  coerce?: (raw: string) => string
}

/** Strip currency symbols, thousands separators and spaces, leaving a numeric string. */
export function coerceAmount(raw: string): string {
  return raw.replace(/[^0-9.]/g, '')
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  {
    key: 'programmeName',
    label: 'Programme name',
    tier: 'required',
    description:
      'The name of the programme the applicant is applying to (must match an active programme in an open round).',
  },
  {
    key: 'externalApplicationId',
    label: 'External application ID',
    tier: 'required',
    description: "The foundation's own reference or ID for this application (NOT our internal ID).",
  },
  {
    key: 'organisationName',
    label: 'Organisation name',
    tier: 'required',
    description: 'The legal or trading name of the applicant organisation.',
  },
  {
    key: 'applicantEmail',
    label: 'Applicant email',
    tier: 'required',
    description:
      "The applicant's contact EMAIL ADDRESS — the person or organisation submitting the application. " +
      'Map a field containing a single email address (e.g. "Contact email", "Applicant email", "Your email"). ' +
      'Prefer the primary applicant/contact email over any generic info@ address if both are present.',
    coerce: (raw: string) => raw.trim().toLowerCase(),
  },
  {
    key: 'amountRequested',
    label: 'Amount requested',
    tier: 'required',
    description: 'The grant amount requested, in GBP — a monetary value.',
    coerce: coerceAmount,
  },
  {
    key: 'bankName',
    label: 'Bank name',
    tier: 'required',
    description: "The name of the bank holding the applicant's account.",
  },
  {
    key: 'bankAccountName',
    label: 'Bank account name',
    tier: 'required',
    description: 'The account holder name on the bank account.',
  },
  {
    key: 'bankAccountNumber',
    label: 'Bank account number',
    tier: 'required',
    description: 'The bank account number (typically 8 digits in the UK).',
  },
  {
    key: 'bankSortCode',
    label: 'Bank sort code',
    tier: 'required',
    description: 'The UK sort code (6 digits, often formatted nn-nn-nn).',
  },
  {
    key: 'charityNumber',
    label: 'Charity number',
    tier: 'one_of',
    description: 'Registered charity number (Charity Commission E&W, or OSCR with an SC prefix).',
  },
  {
    key: 'companyNumber',
    label: 'Company number',
    tier: 'one_of',
    description: 'Companies House registration number.',
  },
  {
    key: 'deliveryArea',
    label: 'Project delivery area',
    tier: 'expected',
    degrades:
      'Without it we cannot look up the deprivation of the area this grant would serve, so the ' +
      'application carries no deprivation context.',
    description:
      'WHERE THE FUNDED PROJECT IS DELIVERED — the place or community that will benefit from the work. ' +
      'Prefer the most specific delivery location available: a delivery/project postcode if asked, ' +
      'otherwise the delivery region, town or area (e.g. "Bradford", "BD1 1AA", "London"). ' +
      'This is used to look up the deprivation of the area served. ' +
      'Do NOT map a field about where the ORGANISATION is based, registered, or has its office/headquarters — ' +
      "that is the applicant's own location, not the area they serve, and must be left unmapped.",
  },
  {
    key: 'budgetBreakdown',
    label: 'Budget breakdown',
    tier: 'expected',
    degrades:
      'Without it the application shows only the total ask, with no view of what the money would ' +
      'be spent on.',
    description:
      'THE PROJECT BUDGET BROKEN INTO LINE ITEMS — what the money will be spent on and how much ' +
      'per item (e.g. staff costs, materials, venue hire, evaluation). Map a field holding a ' +
      'STRUCTURED breakdown: a repeated/tabular set of cost lines, or a set of category→amount ' +
      'pairs. ' +
      'Do NOT map a single total figure — the overall ask is `amountRequested`, a separate field. ' +
      'Do NOT map a free-text narrative describing spending in prose; leave that unmapped so it ' +
      'is kept as a form response.',
  },
  {
    key: 'proposedImpactQuantity',
    label: 'Proposed impact (quantity)',
    tier: 'expected',
    degrades:
      "Without it this application is missing from the programme's proposed-reach totals on Insights.",
    description:
      'THE NUMBER OF BENEFICIARIES / IMPACT UNITS THE APPLICANT PROPOSES TO REACH — a single count, ' +
      'in whatever unit the programme measures (people helped, trees planted, hectares restored, etc.). ' +
      'Map a field stating how many the project WILL reach or benefit (e.g. "we will support 340 young ' +
      'people"). Extract the number only. Do NOT map monetary amounts, and do NOT map figures the ' +
      'applicant reports having ALREADY achieved in the past — this is the forward-looking proposal.',
    coerce: coerceAmount,
  },
]

export const CANONICAL_FIELD_BY_KEY = Object.fromEntries(
  CANONICAL_FIELDS.map((f) => [f.key, f]),
) as Record<CanonicalFieldKey, CanonicalField>

export const REQUIRED_CANONICAL_KEYS: CanonicalFieldKey[] = CANONICAL_FIELDS.filter(
  (f) => f.tier === 'required',
).map((f) => f.key)

/**
 * Groups of which AT LEAST ONE member must resolve. Declared as a list of groups
 * rather than a flag on the field because the constraint is a property of the group,
 * not of either member: neither `charityNumber` nor `companyNumber` is required, but
 * an application holding neither cannot be screened for due diligence at all.
 */
export const REQUIRED_ONE_OF_GROUPS: CanonicalFieldKey[][] = [['charityNumber', 'companyNumber']]

/**
 * Fields whose absence degrades a feature but must not block a submission. Surfaced on
 * the application (see `degrades`) so the degradation is stated rather than silent.
 */
export const EXPECTED_CANONICAL_KEYS: CanonicalFieldKey[] = CANONICAL_FIELDS.filter(
  (f) => f.tier === 'expected',
).map((f) => f.key)

export const CANONICAL_KEYS: CanonicalFieldKey[] = CANONICAL_FIELDS.map((f) => f.key)

/**
 * The one-of groups left entirely unsatisfied by a set of resolved keys. An empty array
 * means every group has at least one member — the condition for promoting.
 *
 * Takes the keys that resolved rather than a payload so both callers can use it: the
 * pipeline (what the mapper worked out) and the reviewer resolve path (what a human
 * chose). Both must agree, or a submission the pipeline held could be waved through by
 * a reviewer who left the pair blank.
 */
export function unmetOneOfGroups(resolvedKeys: Iterable<string>): CanonicalFieldKey[][] {
  const have = new Set(resolvedKeys)
  return REQUIRED_ONE_OF_GROUPS.filter((group) => !group.some((k) => have.has(k)))
}

/** Human phrasing for an unmet group: "a charity number or a company number". */
export function describeOneOfGroup(group: CanonicalFieldKey[]): string {
  const labels = group.map((k) => CANONICAL_FIELD_BY_KEY[k].label.toLowerCase())
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}
