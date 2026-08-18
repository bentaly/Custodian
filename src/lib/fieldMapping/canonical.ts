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
//               No field wears this today — the registration pair that motivated it now
//               sits in `expected` (see below) — but the gate is kept, because "any one
//               of these, we don't mind which" is a real shape a foundation can need.
//   expected  — the application is created without it, but a feature is degraded,
//               so the absence is stated on the application rather than left silent.
//   optional   — the application is created without it and NOTHING is degraded, so
//               nothing is said about it anywhere.
//
// The test between the last two is whether you can NAME what stops working. If you
// can, it is `expected` and the sentence goes in `degrades`. If the honest answer is
// "a reader loses a convenience", it is `optional` — inventing a degradation for it
// would print a complaint on every application that arrives without it, and the
// "Not captured" panel only works while every line in it is worth reading.
//
// The middle tiers exist because a two-state model (required / optional) cost us a
// real bug: `charityNumber` and `companyNumber` are each individually optional — an
// applicant may hold either — but an application with NEITHER can never be screened
// for due diligence. Marked plain optional, such a submission promoted quietly, the
// registry checks never ran, and nothing anywhere reported a problem. It is exactly
// the failure a required field is meant to prevent; it just doesn't fit on one field.
//
// `expected` answers that problem for fields where holding the submission would be
// disproportionate: a foundation that doesn't ask for a delivery area shouldn't have
// every application stuck in a queue, but nor should the deprivation lookup silently
// never run. Promote, and say so.
//
// The registration pair is now one of those, having spent a while as the only `one_of`
// group. Arete's live data settled it: applicants holding neither number are ordinary
// (an unincorporated community group, a project hosted by an unregistered body), and
// the foundation may well decline them for it — but that is a decision to take on the
// application, not one to take by holding the submission in a queue over a number that
// is never coming. What the bug actually demanded was that the absence be VISIBLE and
// that nothing pretend to have screened; both are satisfied by `expected` plus
// `runDueDiligence` returning `no_registration` instead of running a check it can't.
//
// `optional` is not a retreat to that two-state model. What cost us the bug was fields
// that LOOKED optional while something real depended on them; `optional` is for the
// rare field where nothing does, and it earns the tier by surviving the question above
// rather than by nobody having got round to classifying it.
//
// Two `expected` fields can also answer the same question by different means — a
// budget sent as line items, or as a link to a spreadsheet. EXPECTED_ONE_OF_GROUPS
// pairs those, so the "Not captured" panel reports the pair once and only when NEITHER
// arrived. Reporting them separately would print "no view of what the money would be
// spent on" directly beside the budget document, and a panel that cries wolf is one
// admins learn to skim past — which would cost us the very thing it was built for.

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
  | 'budgetBreakdownLink'
  | 'proposedImpactQuantity'

/** How much a field's absence costs. See the header for what each tier means. */
export type FieldTier = 'required' | 'one_of' | 'expected' | 'optional'

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
    // The only `optional` field, and it earns the tier: nothing at all breaks without
    // it. The sort code identifies the bank — it is what `checkBankAccount` verifies
    // and what a BACS payment is actually made against — so this column is read only
    // to print a name beside the digits on the payment panel. It was `required`, which
    // meant a foundation that collects bank details in earnest but never asks which
    // bank (Arete's live form does exactly this: account name, number, sort code, and
    // no bank name) had EVERY submission held in the review queue over a field no
    // feature reads. The column has always been nullable and Finance has always been
    // able to clear it, so `required` was never true of anything but the ingest.
    tier: 'optional',
    description:
      'The name of the bank holding the applicant\'s account (e.g. "Barclays"). ' +
      'Do NOT map the account holder name — that is `bankAccountName`.',
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
    // Reported as a pair with `companyNumber` (REGISTRATION_PAIR_DEGRADES) — either one
    // is a register to screen against, so naming them separately would print "no due
    // diligence" beside a perfectly good company number.
    tier: 'expected',
    degrades:
      'Without a charity number or a company number there is no register to look this ' +
      'organisation up in, so no due diligence check has been run on this application.',
    description: 'Registered charity number (Charity Commission E&W, or OSCR with an SC prefix).',
  },
  {
    key: 'companyNumber',
    label: 'Company number',
    tier: 'expected',
    degrades:
      'Without a company number or a charity number there is no register to look this ' +
      'organisation up in, so no due diligence check has been run on this application.',
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
      'is kept as a form response. ' +
      'Do NOT map a URL or an uploaded file reference — a link is not line items, and mapping ' +
      'one here would make the breakdown look captured when nothing can read it. Links belong ' +
      'in `budgetBreakdownLink`.',
  },
  {
    key: 'budgetBreakdownLink',
    label: 'Budget document',
    tier: 'expected',
    degrades:
      'Without it — and without a line-item breakdown — the application shows only the total ask, ' +
      'with no view of what the money would be spent on.',
    description:
      'A LINK TO A BUDGET DOCUMENT the applicant uploaded or shared — a spreadsheet or similar ' +
      "holding the project budget (e.g. a file-upload question on the foundation's form, which " +
      'typically arrives as a URL to the stored file). Map only an http(s) URL. ' +
      'Do NOT map line items or category→amount pairs; a structured breakdown belongs in ' +
      '`budgetBreakdown`. Do NOT map a link to something that is not the budget.',
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
 * Groups of which AT LEAST ONE member must resolve, or the submission is HELD. Declared
 * as a list of groups rather than a flag on the field because the constraint is a
 * property of the group, not of either member.
 *
 * Deliberately empty, not vestigial. Its one occupant was the registration pair, moved
 * to `expected` once Arete's live data showed how many real applicants hold neither
 * number: the pair's absence is now stated on the application and due diligence reports
 * `no_registration` rather than being quietly skipped, which is what the rule was
 * actually protecting. The gate itself stays wired through `ingest.ts`, `resolve.ts`
 * and `diagnose.ts` — adding a group back is one line, and the two enforcement points
 * must keep agreeing (a reviewer must not be able to wave through what the pipeline
 * held).
 */
export const REQUIRED_ONE_OF_GROUPS: CanonicalFieldKey[][] = []

/**
 * `expected` fields that answer the same question by different means, of which any one
 * satisfies the rest. Unlike REQUIRED_ONE_OF_GROUPS these never block: an unsatisfied
 * group is reported on the application, exactly as an ungrouped `expected` field is.
 *
 * The group carries its own `degrades` because the sentence is a property of the pair,
 * not of either member — "without EITHER of these" is the only honest phrasing, and
 * leaving it on the fields would print it twice or print the wrong half.
 */
export const EXPECTED_ONE_OF_GROUPS: Array<{
  keys: CanonicalFieldKey[]
  degrades: string
  /** Extra guidance for the published spec only; never shown on an application. */
  note?: string
}> = [
  {
    keys: ['charityNumber', 'companyNumber'],
    degrades:
      'Without either there is no register to look this organisation up in, so no due ' +
      'diligence check has been run on this application.',
    note:
      'A registration number can be added later on the application itself, which screens ' +
      'it on the spot.',
  },
  {
    keys: ['budgetBreakdown', 'budgetBreakdownLink'],
    degrades:
      'Without either, the application shows only the total ask, with no view of what the ' +
      'money would be spent on.',
    note:
      'A document is shown to reviewers as a link; only line items feed the budget breakdown ' +
      'and the Custodian score.',
  },
]

/** Keys reported via a group, so `fieldGaps` doesn't also report them individually. */
export const EXPECTED_GROUPED_KEYS: Set<CanonicalFieldKey> = new Set(
  EXPECTED_ONE_OF_GROUPS.flatMap((g) => g.keys),
)

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
export function unmetOneOfGroups(
  resolvedKeys: Iterable<string>,
  // Overridable so the rule stays testable while REQUIRED_ONE_OF_GROUPS is empty:
  // exercised only through the live registry, the test would prove nothing but that
  // nothing is declared.
  groups: CanonicalFieldKey[][] = REQUIRED_ONE_OF_GROUPS,
): CanonicalFieldKey[][] {
  const have = new Set(resolvedKeys)
  return groups.filter((group) => !group.some((k) => have.has(k)))
}

/** Human phrasing for an unmet group: "a charity number or a company number". */
export function describeOneOfGroup(group: CanonicalFieldKey[]): string {
  const labels = group.map((k) => CANONICAL_FIELD_BY_KEY[k].label.toLowerCase())
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}
