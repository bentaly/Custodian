// ─── Canonical field registry ───────────────────────────────────────────────
//
// The single source of truth for the application fields that incoming foundation
// payloads are mapped onto. Used by the lookup matcher, the AI fallback prompt,
// and the admin review UI. Keys match `CreateApplicationSchema` / the
// `applications` columns. Only `required` fields must be resolved before an
// application can be created — an unresolved required field sends the ingest to
// the human review queue. Everything not mapped here flows into `responses`.

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
    key: 'programmeName',
    label: 'Programme name',
    required: true,
    description:
      "The name of the programme the applicant is applying to (must match an active programme in an open round).",
  },
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
    key: 'applicantEmail',
    label: 'Applicant email',
    required: true,
    description:
      "The applicant's contact EMAIL ADDRESS — the person or organisation submitting the application. " +
      'Map a field containing a single email address (e.g. "Contact email", "Applicant email", "Your email"). ' +
      'Prefer the primary applicant/contact email over any generic info@ address if both are present.',
    coerce: (raw: string) => raw.trim().toLowerCase(),
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
  {
    key: 'deliveryArea',
    label: 'Project delivery area',
    required: false,
    description:
      'WHERE THE FUNDED PROJECT IS DELIVERED — the place or community that will benefit from the work. ' +
      'Prefer the most specific delivery location available: a delivery/project postcode if asked, ' +
      'otherwise the delivery region, town or area (e.g. "Bradford", "BD1 1AA", "London"). ' +
      'This is used to look up the deprivation of the area served. ' +
      'Do NOT map a field about where the ORGANISATION is based, registered, or has its office/headquarters — ' +
      'that is the applicant\'s own location, not the area they serve, and must be left unmapped.',
  },
  {
    key: 'budgetBreakdown',
    label: 'Budget breakdown',
    required: false,
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
    required: false,
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
  (f) => f.required,
).map((f) => f.key)

export const CANONICAL_KEYS: CanonicalFieldKey[] = CANONICAL_FIELDS.map((f) => f.key)
