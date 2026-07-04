// ─── Report canonical field registry ────────────────────────────────────────
//
// The single source of truth for the grant-report fields that incoming report
// payloads are mapped onto. Mirrors ./canonical.ts (applications) but targets
// the `report_submissions` columns. Only `required` fields must be resolved
// before a submission can be created — an unresolved required field sends the
// ingest to the review queue. Everything not mapped here flows into `responses`
// (and is still fed to the AI analysis).
//
// Note the deliberate asymmetry with applications on externalApplicationId: it
// is required-to-flow here too, but its real job is grant MATCHING — a report
// whose ID is missing or unrecognised is held for a human to link, never
// rejected (foundations embed the ID as a hidden form field; charities can't be
// trusted to type it).

import { coerceAmount } from './canonical'

export type ReportCanonicalFieldKey =
  | 'externalApplicationId'
  | 'organisationName'
  | 'impactSummary'
  | 'charityNumber'
  | 'companyNumber'
  | 'programmeName'
  | 'amountAwarded'
  | 'awardDate'
  | 'awardEndDate'
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | 'grantTitle'
  | 'grantPurpose'
  | 'challenges'
  | 'lessons'
  | 'caseStudies'
  | 'testimonials'
  | 'otherComments'
  | 'beneficiaryCount'
  | 'deliveryArea'

export interface ReportCanonicalField {
  key: ReportCanonicalFieldKey
  /** Human label shown in the review UI. */
  label: string
  /** Required fields must be resolved before promotion; otherwise → needs_review. */
  required: boolean
  /** Guidance for the AI fallback and reviewers on what this field holds. */
  description: string
  /** Optional transform from the raw (string) payload value to canonical form. */
  coerce?: (raw: string) => string
}

/** Keep only digits, for count-like fields ("~130 young people" → "130"). */
export function coerceCount(raw: string): string {
  const match = raw.replace(/,/g, '').match(/\d+/)
  return match ? match[0] : ''
}

export const REPORT_CANONICAL_FIELDS: ReportCanonicalField[] = [
  {
    key: 'externalApplicationId',
    label: 'External application ID',
    required: true,
    description:
      "The foundation's own reference or ID for the ORIGINAL APPLICATION this report is about " +
      '(NOT our internal ID, and not a reference for the report itself). Used to link the report ' +
      'to its grant. Often sent as a hidden form field.',
  },
  {
    key: 'organisationName',
    label: 'Organisation name',
    required: true,
    description: 'The legal or trading name of the reporting charity/organisation.',
  },
  {
    key: 'impactSummary',
    label: 'Impact summary',
    required: true,
    description:
      'The main narrative of what difference the funding made — e.g. "How has our funding made a ' +
      'difference?", "Grant impact summary", "Impact on young people supported". The core content ' +
      'of the report.',
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
    key: 'programmeName',
    label: 'Programme name',
    required: false,
    description:
      'The programme or funding stream the grant was awarded from (e.g. "Funding stream the grant ' +
      'was awarded from").',
  },
  {
    key: 'amountAwarded',
    label: 'Amount awarded',
    required: false,
    description:
      'The grant amount as stated on the report, in GBP — e.g. "Funding award amount", "How much ' +
      'funding have you received to date?". Used to cross-check the matched grant.',
    coerce: coerceAmount,
  },
  {
    key: 'awardDate',
    label: 'Award / start date',
    required: false,
    description:
      'When the funding was awarded or commenced — e.g. "Date of funding award", "When did our ' +
      'partnership start?".',
  },
  {
    key: 'awardEndDate',
    label: 'Award end date',
    required: false,
    description: 'When the funding period ends — e.g. "Date of funding award end".',
  },
  {
    key: 'contactName',
    label: 'Contact name',
    required: false,
    description: 'Name of the person submitting the report.',
  },
  {
    key: 'contactEmail',
    label: 'Contact email',
    required: false,
    description: 'Email address of the person submitting the report.',
  },
  {
    key: 'contactPhone',
    label: 'Contact phone',
    required: false,
    description: 'Phone number of the person submitting the report.',
  },
  {
    key: 'grantTitle',
    label: 'Grant / funding title',
    required: false,
    description: 'The title of the funding award or project — e.g. "Funding award title".',
  },
  {
    key: 'grantPurpose',
    label: 'Grant purpose',
    required: false,
    description:
      'What the grant was awarded for / how the funding was intended to be used — e.g. "Grant ' +
      'awarded summary", "Funding award purpose", "How was our funding intended to support…".',
  },
  {
    key: 'challenges',
    label: 'Challenges',
    required: false,
    description:
      'Challenges faced in delivering the grant and how they were overcome or addressed.',
  },
  {
    key: 'lessons',
    label: 'Lessons learned',
    required: false,
    description: 'Summary of learnings from the grant delivery.',
  },
  {
    key: 'caseStudies',
    label: 'Case studies',
    required: false,
    description: 'Anonymous case studies shared in the report.',
  },
  {
    key: 'testimonials',
    label: 'Testimonials',
    required: false,
    description: 'Testimonials or quotes shared in the report.',
  },
  {
    key: 'otherComments',
    label: 'Other comments',
    required: false,
    description: 'Any other comments the charity added.',
  },
  {
    key: 'beneficiaryCount',
    label: 'Beneficiary count',
    required: false,
    description:
      'A directly-stated NUMBER of people/beneficiaries helped — e.g. "Number of beneficiaries", ' +
      '"How many young people benefited?". Map only fields whose value is a count, not a narrative.',
    coerce: coerceCount,
  },
  {
    key: 'deliveryArea',
    label: 'Delivery area',
    required: false,
    description:
      'Where the funded work was delivered — region, town, or postcode (e.g. "Project delivery ' +
      'region", "Geographical location"). NOT where the organisation is headquartered.',
  },
]

export const REPORT_CANONICAL_FIELD_BY_KEY = Object.fromEntries(
  REPORT_CANONICAL_FIELDS.map((f) => [f.key, f]),
) as Record<ReportCanonicalFieldKey, ReportCanonicalField>

export const REQUIRED_REPORT_CANONICAL_KEYS: ReportCanonicalFieldKey[] =
  REPORT_CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.key)

export const REPORT_CANONICAL_KEYS: ReportCanonicalFieldKey[] = REPORT_CANONICAL_FIELDS.map(
  (f) => f.key,
)
