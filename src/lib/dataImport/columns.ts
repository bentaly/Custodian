// ─── The import workbook's column registry ──────────────────────────────────
//
// The spreadsheet a foundation fills in at onboarding, described once. This drives
// the generated template (headers, order, dropdowns, help text), the parser, the
// validation screen, and the "what we capture" documentation — so the file we hand
// out and the file we accept cannot drift apart.
//
// Columns carry a TIER, borrowed deliberately from the application field registry
// (src/lib/fieldMapping/canonical.ts) because the problem is identical: a missing
// field must never be indistinguishable from a question the foundation never asked.
//
//   required  — the row is meaningless without it; the import is blocked.
//   one_of    — at least one member of the group must be present (see ONE_OF_GROUPS).
//   expected  — imports fine, but a feature is degraded, so `degrades` says what is
//               lost and the review step shows it. Never blocks: a foundation that
//               never recorded delivery areas should still be able to onboard.
//   optional  — genuinely take-it-or-leave-it.
//
// Note the asymmetry with the application registry: bank details are `required` for a
// live submission (you cannot pay someone without them) but absent here entirely — an
// imported grant from 2019 was paid years ago, and asking for account numbers to
// record history would be both intrusive and pointless.

export type ImportTier = 'required' | 'one_of' | 'expected' | 'optional'

export type SheetKey = 'grants' | 'payments' | 'reports'

export type CellType = 'text' | 'number' | 'money' | 'date' | 'enum' | 'lookup'

export interface ImportColumn {
  /** Key on the parsed row object. */
  key: string
  /** The header written into the template, and matched on read. */
  header: string
  /**
   * A noun for use mid-sentence, where the header reads as a question. Without it
   * "Where the work happens" produces "1 grant with no where the work happens".
   * Defaults to the lower-cased header.
   */
  shortLabel?: string
  tier: ImportTier
  type: CellType
  /** Shown under the header in the template's instructions sheet. */
  help: string
  /** For `expected`: what stops working without it. Shown in the review step. */
  degrades?: string
  /** For `enum`: the permitted values, used for the dropdown and validation. */
  options?: string[]
  /**
   * For `lookup`: which per-client list populates the dropdown. Resolved when the
   * template is generated, and matched (with a confirm step) on upload.
   */
  lookup?: 'programme' | 'round' | 'reference' | 'impactUnit'
}

// ─── Sheet 1: Grants ────────────────────────────────────────────────────────

export const GRANT_COLUMNS: ImportColumn[] = [
  {
    key: 'reference',
    header: 'Application reference',
    tier: 'required',
    type: 'text',
    help: 'Your own reference for this application, from whatever system you use today. This becomes the grant’s reference in Custodian, and it is the code a charity quotes on a future report so the report links itself automatically. If you have none, leave the column blank and we will generate them.',
  },
  {
    key: 'organisationName',
    header: 'Organisation name',
    tier: 'required',
    type: 'text',
    help: 'The grantee organisation, as you would want it to read on screen.',
  },
  {
    key: 'programme',
    header: 'Programme',
    tier: 'required',
    type: 'lookup',
    lookup: 'programme',
    help: 'Which of your programmes funded this grant. Pick from the dropdown.',
  },
  {
    key: 'round',
    header: 'Round',
    tier: 'required',
    type: 'lookup',
    lookup: 'round',
    help: 'The round or year this grant belongs to. Pick an existing round, or type a new name and we will create it during the import.',
  },
  {
    key: 'awardDate',
    header: 'Award date',
    tier: 'required',
    type: 'date',
    help: 'When the decision was made, even if that predates your use of Custodian. Format YYYY-MM-DD.',
  },
  {
    key: 'amountAwarded',
    header: 'Amount awarded',
    tier: 'required',
    type: 'money',
    help: 'The total grant, across all years. Numbers only — no £ sign, no commas.',
  },
  {
    key: 'status',
    header: 'Status',
    tier: 'required',
    type: 'enum',
    options: ['Active', 'Completed', 'Cancelled'],
    help: 'Active means money still to pay or reports still to come. Completed means the grant has run its course.',
  },
  {
    key: 'charityNumber',
    header: 'Charity number',
    tier: 'one_of',
    type: 'text',
    help: 'Registered charity number, if the grantee has one.',
  },
  {
    key: 'companyNumber',
    header: 'Company number',
    tier: 'one_of',
    type: 'text',
    help: 'Companies House number, if the grantee has one. A CIC will have this and no charity number.',
  },
  {
    key: 'contactEmail',
    header: 'Contact email',
    tier: 'expected',
    type: 'text',
    degrades:
      'Nothing can be emailed to this grantee — no award letter can be resent, and no report reminder can reach them.',
    help: 'The grantee’s contact address.',
  },
  {
    key: 'deliveryArea',
    header: 'Where the work happens',
    shortLabel: 'location',
    tier: 'expected',
    type: 'text',
    degrades:
      'No deprivation context and no regional breakdown for this grant, so it is missing from those parts of Insights.',
    help: 'The community served — a town, district or postcode. Not the grantee’s head office. One cell here drives the whole deprivation and regional picture.',
  },
  {
    key: 'purpose',
    header: 'What the money is for',
    shortLabel: 'stated purpose',
    tier: 'expected',
    type: 'text',
    degrades:
      'A future report on this grant has nothing to be judged against, so its alignment analysis will be thin.',
    help: 'One line, in your words — the same phrasing you would put on an award letter.',
  },
  {
    key: 'endDate',
    header: 'Grant end date',
    tier: 'optional',
    type: 'date',
    help: 'When the grant period finishes, if you track it. Format YYYY-MM-DD.',
  },
  {
    key: 'impactQuantity',
    shortLabel: 'impact figure',
    header: 'Impact figure so far',
    tier: 'optional',
    type: 'number',
    help: 'Any impact already recorded for this grant — beneficiaries reached, hectares restored, whatever your programme measures. Numbers only.',
  },
]

// ─── Sheet 2: Payments ──────────────────────────────────────────────────────
//
// One row per instalment, not per grant. This is the sheet the prototype missed: a
// grant paid in six instalments cannot be described by a single "paid to date"
// figure, because Finance has to show what is due on which date, and reconciliation
// has to add up against the foundation's own ledger.

export const PAYMENT_COLUMNS: ImportColumn[] = [
  {
    key: 'reference',
    header: 'Application reference',
    tier: 'required',
    type: 'lookup',
    lookup: 'reference',
    help: 'Which grant this payment belongs to. Must match a reference on the Grants sheet.',
  },
  {
    key: 'dueDate',
    header: 'Due date',
    tier: 'required',
    type: 'date',
    help: 'When the instalment was or is due. Format YYYY-MM-DD.',
  },
  {
    key: 'amount',
    header: 'Amount',
    tier: 'required',
    type: 'money',
    help: 'This instalment only, not the whole grant.',
  },
  {
    key: 'paid',
    header: 'Paid?',
    tier: 'required',
    type: 'enum',
    options: ['Yes', 'No'],
    help: 'Has this instalment actually gone out?',
  },
  {
    key: 'paidDate',
    header: 'Date paid',
    shortLabel: 'payment date',
    tier: 'expected',
    type: 'date',
    degrades:
      'The payment counts as paid but carries no date, so it cannot be placed in a spend-over-time view.',
    help: 'Leave blank if not yet paid. Format YYYY-MM-DD.',
  },
]

// ─── Sheet 3: Reports ───────────────────────────────────────────────────────

export const REPORT_COLUMNS: ImportColumn[] = [
  {
    key: 'reference',
    header: 'Application reference',
    tier: 'required',
    type: 'lookup',
    lookup: 'reference',
    help: 'Which grant this reporting milestone belongs to.',
  },
  {
    key: 'label',
    header: 'Milestone',
    tier: 'required',
    type: 'text',
    help: 'What the report is called — e.g. “Interim report”, “Year 1 report”, “Final report”.',
  },
  {
    key: 'dueDate',
    header: 'Due date',
    tier: 'required',
    type: 'date',
    help: 'When the report is or was due. Format YYYY-MM-DD.',
  },
  {
    key: 'receivedDate',
    header: 'Date received',
    tier: 'optional',
    type: 'date',
    help: 'Leave blank if the report is still outstanding — that is exactly what makes it show as due or overdue on the Reports screen.',
  },
]

export const SHEETS: Record<SheetKey, { title: string; columns: ImportColumn[]; blurb: string }> = {
  grants: {
    title: 'Grants',
    columns: GRANT_COLUMNS,
    blurb: 'One row per grant. Start with the grants that still owe you money or a report.',
  },
  payments: {
    title: 'Payments',
    columns: PAYMENT_COLUMNS,
    blurb:
      'One row per instalment. For a completed grant you can use a single row for the full amount.',
  },
  reports: {
    title: 'Reports',
    columns: REPORT_COLUMNS,
    blurb: 'One row per reporting milestone, received or still outstanding.',
  },
}

/**
 * Groups of which at least one member must be present. Mirrors the application
 * registry's `[charityNumber, companyNumber]` group and for the same reason: either
 * alone is fine, but with neither there is no register to check, so due diligence can
 * never run on this grantee. Unlike the application pipeline this does not block the
 * import — a historic grant is a record of something that already happened, and
 * refusing it would be refusing history. It is reported as a degradation instead.
 */
export const ONE_OF_GROUPS: Array<{ keys: string[]; label: string; degrades: string }> = [
  {
    keys: ['charityNumber', 'companyNumber'],
    label: 'Charity or company number',
    degrades:
      'No register to check, so due diligence can never run for this grantee, and an incoming report cannot be matched to them by registration number.',
  },
]

export const TEMPLATE_VERSION = '1'

/** Sheet holding the dropdown source lists and the file's fingerprint. Hidden. */
export const LOOKUP_SHEET = '_Custodian'

export function columnsFor(sheet: SheetKey): ImportColumn[] {
  return SHEETS[sheet].columns
}

/** The noun to use mid-sentence, e.g. "3 grants with no {label}". */
export function columnLabel(column: ImportColumn): string {
  return column.shortLabel ?? column.header.toLowerCase()
}
