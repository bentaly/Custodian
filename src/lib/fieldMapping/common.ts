// ─── Built-in common field aliases ───────────────────────────────────────────
//
// A hand-curated, global dictionary of the field names foundations commonly use,
// mapped to canonical fields. It sits between a client's own lookup table and the
// AI fallback: where the per-client table has no entry, a normalised match here
// is auto-applied directly — same standing as a per-client lookup hit, no review.
// The per-client table runs first and still wins, so a client can override any
// alias. See the common-dictionary step in the ingest orchestrator.
//
// Authoring rules:
//  - ONLY list aliases we are 100% certain of — they are applied without review.
//    If a header could mean two different canonical fields (e.g. "Organisation
//    registration number" — charity *or* company number depending on the
//    regulator), DO NOT list it; leave it to the AI/human. The load-time guard
//    throws on any alias that resolves to two canonical fields, so conflicts
//    surface in dev/CI immediately.
//  - Aliases are matched after `normaliseKey`, so case, punctuation, apostrophes,
//    currency symbols and whitespace don't matter — author them readably.
//  - British English (Organisation, not Organization).
//
// Source corpus: real exported application forms from Montirex, Arete and the
// the7stars foundation (multiple programmes). Extend as new forms are onboarded.

import { CANONICAL_KEYS, type CanonicalFieldKey } from './canonical'

/**
 * Normalise a field name for alias matching: lowercase, drop apostrophes so
 * "bank's" === "banks", strip currency symbols, reduce any run of other
 * non-alphanumerics (spaces, slashes, punctuation, newlines) to a single space.
 */
export function normaliseKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[£$€]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Canonical field → known incoming field names. Authored readably; normalised at
 * module load. `programmeName` is intentionally absent — it is not a form field
 * (it's implied by which form/round the submission came through).
 */
export const COMMON_MAPPINGS: Partial<Record<CanonicalFieldKey, string[]>> = {
  externalApplicationId: [
    'entry id',
    'submission id',
    'application id',
    'application reference',
    'your reference',
  ],
  organisationName: [
    'organisation name',
    'organisation/charity name',
    'charity/organisation name',
    'organisation or charity name',
    'organisation/company name',
    'charity name',
    'applicant organisation',
    'applicant organisation name',
    'company name',
  ],
  // Only phrasings that unambiguously ask the applicant to describe THEIR OWN
  // organisation. "Project summary", "summary" and "please give a brief description"
  // are deliberately absent: on a real form each of those is as likely to be asking
  // about the project the grant would fund, and mapping one here would put the
  // project's pitch where the screen prints "who these people are".
  organisationSummary: [
    'organisation summary',
    'summary of your organisation',
    'organisation description',
    'description of your organisation',
    'brief description of your organisation',
    'about your organisation',
    'about the organisation',
    'about your charity',
    'tell us about your organisation',
    'tell us about your charity',
    'what does your organisation do',
    'what does your charity do',
    'what your organisation does',
    'what your charity does',
  ],
  amountRequested: [
    'amount requested',
    'funding requested',
    'funding amount requested',
    'total funding requested',
    'requested amount',
    'grant amount',
    'grant amount requested',
    'amount of funding requested',
  ],
  // Every alias names the funds as UNRESTRICTED. A form asking this normally asks for
  // restricted reserves and a bank balance in the same breath (Arete's asks for all
  // three consecutively), so a bare "reserves" is left to the AI/human — it is exactly
  // the kind of near-miss that would silently record one figure as another.
  unrestrictedReserves: [
    'unrestricted reserves',
    'unrestricted funding reserves',
    'unrestricted funds',
    'current unrestricted reserves',
    'current unrestricted funding reserves',
    'your current unrestricted reserves',
    'your current unrestricted funding reserves',
    'total unrestricted reserves',
    'unrestricted reserves held',
  ],
  bankName: [
    'bank name',
    "bank's name",
    "your bank's name",
    'your bank name',
    'name of bank',
    'name of your bank',
  ],
  bankAccountName: [
    'bank account name',
    'your bank account name',
    "bank account's name",
    "your bank account's name",
    'account name',
    'account holder name',
    'name on account',
    'name on the account',
  ],
  bankAccountNumber: [
    'bank account number',
    'your bank account number',
    "bank account's number",
    "your bank account's number",
    'account number',
  ],
  bankSortCode: [
    'bank sort code',
    'your bank sort code',
    'sort code',
    "bank account's sort code",
    "your bank account's sort code",
  ],
  charityNumber: [
    'charity number',
    'charity no',
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
  deliveryArea: [
    'project delivery location',
    'project delivery postcode',
    'project delivery region',
    'delivery location',
    'delivery postcode',
    'delivery region',
    'in what region will your project be delivered',
    'which region will your project be delivered',
    'in what area will your project be delivered',
    'which area will your project be delivered',
  ],
  // Only names that unambiguously mean an ITEMISED breakdown. Bare "budget" /
  // "project budget" / "total project cost" are deliberately absent: they usually
  // hold a single total, which belongs to `amountRequested` or nowhere — mapping
  // them here without review would silently produce a one-line breakdown.
  budgetBreakdown: [
    'budget breakdown',
    'breakdown of budget',
    'project budget breakdown',
    'project breakdown',
    'breakdown of project budget',
    'budget line items',
    'budget lines',
    'budget items',
    'cost breakdown',
    'breakdown of costs',
    'breakdown of project costs',
    'costs breakdown',
    'itemised budget',
    'itemised costs',
    'line item budget',
  ],
  // Names that unambiguously mean a FILE holding the budget, not the figures
  // themselves. Every one of these says upload / file / document / attachment —
  // a form asking "budget breakdown" wants fields, one asking "budget upload" wants
  // a link, and only the second belongs here. Long question-style titles ("Please
  // upload a budget relating to your funding request…") are left to the AI fallback
  // rather than guessed at.
  budgetBreakdownLink: [
    'budget upload',
    'upload budget',
    'upload your budget',
    'budget file',
    'budget document',
    'budget attachment',
    'budget spreadsheet',
    'attach budget',
    'attach your budget',
  ],
}

// Build the normalised lookup: normalised alias → canonical key. Guard against an
// alias being claimed by two canonical fields (a curation bug), and against a
// canonical field colliding with itself via two aliases that normalise the same.
const CANONICAL_KEY_SET = new Set<string>(CANONICAL_KEYS)
const aliasToCanonical = new Map<string, CanonicalFieldKey>()

for (const [canonical, aliases] of Object.entries(COMMON_MAPPINGS) as [
  CanonicalFieldKey,
  string[],
][]) {
  if (!CANONICAL_KEY_SET.has(canonical)) {
    throw new Error(`COMMON_MAPPINGS: unknown canonical field "${canonical}"`)
  }
  for (const alias of aliases) {
    const norm = normaliseKey(alias)
    if (!norm) continue
    const existing = aliasToCanonical.get(norm)
    if (existing && existing !== canonical) {
      throw new Error(
        `COMMON_MAPPINGS: alias "${alias}" (→ "${norm}") maps to both "${existing}" and "${canonical}"`,
      )
    }
    aliasToCanonical.set(norm, canonical)
  }
}

/** Resolve a raw incoming field name to a canonical field via the common dictionary. */
export function matchCommonKey(sourceKey: string): CanonicalFieldKey | null {
  return aliasToCanonical.get(normaliseKey(sourceKey)) ?? null
}
