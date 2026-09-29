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
  /**
   * The fields the AI fallback hunts for when the rules and dictionary miss them. No
   * longer a gate: a report is held only when it has no grant (see `ingest.ts`), so the
   * Submission guide shows no report field as Required.
   */
  required: boolean
  /** Guidance for the AI fallback and reviewers on what this field holds. */
  description: string
  /** Optional transform from the raw (string) payload value to canonical form. */
  coerce?: (raw: string) => string
  /** What a foundation loses by not sending it, for the Submission guide. */
  degrades?: string
}

/**
 * Read a count ("~130 young people" → "130", "2,500 households" → "2500"), or nothing.
 *
 * The answer must hold exactly ONE whole number. Anything else reads as nothing rather
 * than a guess, because this figure is summed into Insights as fact: taking the first
 * run of digits read "1.2k" as 1, "60-70" as 60 and "12.5" as 12. An unread answer is
 * not lost: the report lands, its screen shows what they wrote beside the figure, the
 * analysis looks for a figure in the narrative, and an admin can type the right one.
 */
export function coerceCount(raw: string): string {
  const numbers = [...raw.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
  if (numbers.length !== 1) return ''
  const [match] = numbers
  const token = match![0].replace(/,+$/, '')
  // A decimal is not a count of people.
  if (token.includes('.')) return ''
  // Commas only as thousands separators: "2,500" yes, "25,00" no.
  if (token.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(token)) return ''
  // "1k", "3 m", "45%": a scale or a share, not a count.
  const after = raw.slice(match!.index! + token.length)
  if (/^\s*(k|m|bn|%|per\s*cent|percent)\b/i.test(after) || /^\s*%/.test(after)) return ''
  return token.replace(/,/g, '')
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
    degrades:
      'we try the charity number instead, and a report neither can place waits on the Reports ' +
      'screen for an admin to choose its grant.',
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
      'The main narrative of what difference the funding made, e.g. "How has our funding made a ' +
      'difference?", "Grant impact summary", "Impact on young people supported". The core content ' +
      'of the report.',
    degrades: 'the analysis has only the rest of the report to go on.',
  },
  {
    key: 'charityNumber',
    label: 'Charity number',
    required: false,
    description: 'Registered charity number (Charity Commission E&W, or OSCR with an SC prefix).',
    degrades:
      'a report without your application reference cannot be linked to its grant automatically.',
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
    key: 'awardEndDate',
    label: 'Award end date',
    required: false,
    description: 'When the funding period ends, e.g. "Date of funding award end".',
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
    description: 'The title of the funding award or project, e.g. "Funding award title".',
  },
  {
    key: 'grantPurpose',
    label: 'Grant purpose',
    required: false,
    description:
      'What the grant was awarded for / how the funding was intended to be used, e.g. "Grant ' +
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
      'A directly-stated NUMBER of people/beneficiaries helped, read as the TOTAL SO FAR: the ' +
      'running count for the whole grant to date, not the figure for this reporting period alone. ' +
      "A grant's reports replace each other rather than adding up, so the latest report's count " +
      'is the one that stands. e.g. "Number of beneficiaries", "How many people have you supported ' +
      'to date?". Map only fields whose value is a count, not a narrative.',
    degrades: 'the figure is read from the report itself, where it states one.',
    coerce: coerceCount,
  },
  {
    key: 'deliveryArea',
    label: 'Delivery area',
    required: false,
    description:
      'Where the funded work was delivered: region, town, or postcode (e.g. "Project delivery ' +
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
