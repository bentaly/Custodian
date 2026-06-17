// ─── Canonical field registry ───────────────────────────────────────────────
//
// The single source of truth for the application fields that incoming foundation
// payloads are mapped onto. Used by the lookup matcher, the AI fallback prompt,
// and the admin review UI. Keys match `CreateApplicationSchema` / the
// `applications` columns. Only `required` fields must be resolved before an
// application can be created — an unresolved required field sends the ingest to
// the human review queue. Everything not mapped here flows into `responses`.

export type CanonicalFieldKey =
  | 'externalApplicationId'
  | 'organisationName'
  | 'amountRequested'
  | 'bankName'
  | 'bankAccountName'
  | 'bankAccountNumber'
  | 'bankSortCode'
  | 'charityNumber'
  | 'companyNumber'

export interface CanonicalField {
  key: CanonicalFieldKey
  /** Human label shown in the review UI. */
  label: string
  /** Required fields must be resolved before promotion; otherwise → needs_review. */
  required: boolean
  /** Guidance for the AI fallback and reviewers on what this field holds. */
  description: string
  /** Optional transform from the raw (string) payload value to canonical form. */
  coerce?: (raw: string) => string
}

/** Strip currency symbols, thousands separators and spaces, leaving a numeric string. */
export function coerceAmount(raw: string): string {
  return raw.replace(/[^0-9.]/g, '')
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  {
    key: 'externalApplicationId',
    label: 'External application ID',
    required: true,
    description: "The foundation's own reference or ID for this application (NOT our internal ID).",
  },
  {
    key: 'organisationName',
    label: 'Organisation name',
    required: true,
    description: 'The legal or trading name of the applicant organisation.',
  },
  {
    key: 'amountRequested',
    label: 'Amount requested',
    required: true,
    description: 'The grant amount requested, in GBP — a monetary value.',
    coerce: coerceAmount,
  },
  {
    key: 'bankName',
    label: 'Bank name',
    required: true,
    description: "The name of the bank holding the applicant's account.",
  },
  {
    key: 'bankAccountName',
    label: 'Bank account name',
    required: true,
    description: 'The account holder name on the bank account.',
  },
  {
    key: 'bankAccountNumber',
    label: 'Bank account number',
    required: true,
    description: 'The bank account number (typically 8 digits in the UK).',
  },
  {
    key: 'bankSortCode',
    label: 'Bank sort code',
    required: true,
    description: 'The UK sort code (6 digits, often formatted nn-nn-nn).',
  },
  {
    key: 'charityNumber',
    label: 'Charity number',
    required: false,
    description: 'Registered charity number (Charity Commission E&W, or OSCR with an SC prefix).',
  },
  {
    key: 'companyNumber',
    label: 'Company number',
    required: false,
    description: 'Companies House registration number.',
  },
]

export const CANONICAL_FIELD_BY_KEY = Object.fromEntries(
  CANONICAL_FIELDS.map((f) => [f.key, f]),
) as Record<CanonicalFieldKey, CanonicalField>

export const REQUIRED_CANONICAL_KEYS: CanonicalFieldKey[] = CANONICAL_FIELDS.filter(
  (f) => f.required,
).map((f) => f.key)

export const CANONICAL_KEYS: CanonicalFieldKey[] = CANONICAL_FIELDS.map((f) => f.key)
