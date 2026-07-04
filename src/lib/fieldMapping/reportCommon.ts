// ─── Built-in common report field aliases ────────────────────────────────────
//
// The grant-report counterpart of ./common.ts: a hand-curated, global dictionary
// of the field names foundations commonly use on REPORT forms, mapped to report
// canonical fields. Same standing and authoring rules as the application
// dictionary: only aliases we are 100% certain of (applied without review), the
// per-client lookup table runs first and wins, matching happens after
// `normaliseKey`, British English.
//
// Source corpus: real report forms from Montirex, Arete (incl. submitted
// Typeform exports) and the7stars foundation (Child Poverty, Project, Shine
// Bright Long-Term, Social Impact + the public web form). Extend as new
// foundations are onboarded.

import { normaliseKey } from './common'
import { REPORT_CANONICAL_KEYS, type ReportCanonicalFieldKey } from './reportCanonical'

/** Canonical report field → known incoming field names. Normalised at module load. */
export const REPORT_COMMON_MAPPINGS: Partial<Record<ReportCanonicalFieldKey, string[]>> = {
  externalApplicationId: [
    'external application id',
    'application id',
    'application reference',
    'application ref',
    'your reference',
    'grant reference',
    'grant ref',
    'award reference',
  ],
  organisationName: [
    'organisation name',
    "organisation's name",
    'charity name',
    "charity's name",
    'charity/organisation name',
    'organisation/charity name',
    'organisation or charity name',
    'reporting organisation',
  ],
  impactSummary: [
    'impact summary',
    'grant impact summary',
    'project impact summary',
    'grant impact',
    'impact on young people supported',
    'how has our funding made a difference to young people',
    'how has our funding made a difference to your scale and growth since we last touched base',
    'what difference has the funding made',
    'what difference has our funding made',
  ],
  charityNumber: [
    'charity number',
    'charity no',
    "charity's registration number",
    'charity registration number',
    'registered charity number',
    'charity commission number',
  ],
  companyNumber: [
    'company number',
    'company no',
    'company registration number',
    'registered company number',
    'companies house number',
  ],
  programmeName: [
    'funding stream',
    'funding stream the grant was awarded from',
    'programme',
    'programme name',
    'grant programme',
  ],
  amountAwarded: [
    'funding award amount',
    'funding amount awarded',
    'amount awarded',
    'grant awarded',
    'grant amount awarded',
    'how much funding have you received to date',
  ],
  awardDate: [
    'date of funding award',
    'date of funding award commencement',
    'when did our partnership start',
    'award date',
    'date of award',
    'funding start date',
  ],
  awardEndDate: ['date of funding award end', 'award end date', 'funding end date'],
  contactName: ['contact name', 'name of representative and contact'],
  contactEmail: ['contact email', 'contact email address'],
  contactPhone: ['contact phone no', 'contact phone', 'contact phone number', 'contact telephone'],
  grantTitle: ['funding award title', 'funding title', 'grant title', 'project title'],
  grantPurpose: [
    'grant purpose',
    'funding purpose',
    'funding award purpose',
    'grant awarded summary',
    'project awarded summary',
    'how funding was directed',
    'how will our funding be directed',
    'how was our funding intended to support young people who are / at risk of becoming neet',
    'how was our funding intended to support your delivery of tangible local impact',
    'how was our funding intended to support your scale and growth',
  ],
  challenges: [
    'challenges and how overcome',
    'challenges encountered',
    'did you face any challenges in delivering the grant, how were these overcome',
    'have you faced any challenges across the partnership which hindered your grant delivery',
  ],
  lessons: [
    'lessons learned',
    'lessons learnt',
    'learnings',
    'summary of learnings',
    'please provide a summary of learnings from the grant delivery',
    // the7stars Project form's typo, verbatim:
    'please project a summary of learnings from the grant delivery',
  ],
  caseStudies: [
    'case studies',
    'anonymous case studies',
    'are you able to share any anonymous case studies',
  ],
  testimonials: [
    'testimonials',
    'are you able to share any testimonials',
    'are you able to share any testimonials/anonymous case studies related to the impact of our funding',
  ],
  otherComments: [
    'any other comments',
    'other comments',
    'additional comments',
    'any additional comments',
  ],
  beneficiaryCount: [
    'beneficiary count',
    'number of beneficiaries',
    'number of beneficiaries (0-18 years)',
    'number of beneficiaries supported by the org annually (0-18 years)',
    'number of people supported',
    'how many young people benefited',
    'how many people were helped',
  ],
  deliveryArea: [
    'delivery region',
    'delivery location',
    'project delivery region',
    'project delivery postcode',
    'funding delivery region',
    'geographical location',
    'specific geographical location',
    'specific location',
    'post code of programme delivery',
    'post code of impact',
  ],
}

// Build the normalised lookup with the same guards as the application dictionary.
const REPORT_CANONICAL_KEY_SET = new Set<string>(REPORT_CANONICAL_KEYS)
const aliasToCanonical = new Map<string, ReportCanonicalFieldKey>()

for (const [canonical, aliases] of Object.entries(REPORT_COMMON_MAPPINGS) as [
  ReportCanonicalFieldKey,
  string[],
][]) {
  if (!REPORT_CANONICAL_KEY_SET.has(canonical)) {
    throw new Error(`REPORT_COMMON_MAPPINGS: unknown canonical field "${canonical}"`)
  }
  for (const alias of aliases) {
    const norm = normaliseKey(alias)
    if (!norm) continue
    const existing = aliasToCanonical.get(norm)
    if (existing && existing !== canonical) {
      throw new Error(
        `REPORT_COMMON_MAPPINGS: alias "${alias}" (→ "${norm}") maps to both "${existing}" and "${canonical}"`,
      )
    }
    aliasToCanonical.set(norm, canonical)
  }
}

/** Resolve a raw incoming field name to a report canonical field via the common dictionary. */
export function matchCommonReportKey(sourceKey: string): ReportCanonicalFieldKey | null {
  return aliasToCanonical.get(normaliseKey(sourceKey)) ?? null
}
