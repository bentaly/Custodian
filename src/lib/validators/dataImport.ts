import { z } from 'zod'
import { MAX_GRANTS_PER_IMPORT } from '../dataImport/validate'

// The wire shape of a parsed workbook. The browser does the .xlsx parsing (see
// lib/dataImport/workbook.ts) and posts the result here — so these schemas are the
// door: everything past them is treated as tenant data and written to the database.
// The server re-runs the full validation over what arrives; the browser's own
// validation is a convenience for the wizard, never the authority.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

export const GrantRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  reference: z.string().max(120),
  organisationName: z.string().min(1).max(300),
  programme: z.string().min(1).max(300),
  round: z.string().min(1).max(300),
  awardDate: isoDate,
  amountAwarded: z.number().finite().min(0).max(1_000_000_000),
  amountPaid: z.number().finite().min(0).max(1_000_000_000).nullable(),
  status: z.enum(['active', 'completed', 'cancelled']),
  charityNumber: z.string().max(60).nullable(),
  companyNumber: z.string().max(60).nullable(),
  contactEmail: z.string().max(320).nullable(),
  deliveryArea: z.string().max(300).nullable(),
  purpose: z.string().max(2000).nullable(),
  /** The Themes cell, split on semicolons. Empty means "all of the programme's". */
  themes: z.array(z.string().min(1).max(100)).max(50),
  endDate: isoDate.nullable(),
  /** Whole years, where the foundation tracks it. See `awards.duration_years`. */
  durationYears: z.number().int().positive().max(50).nullable(),
  impactQuantity: z.number().finite().min(0).nullable(),
  /**
   * Only meaningful for a grant with instalments still to pay. Loose length caps rather
   * than a digit pattern: the modulus check (`lib/bankVerification`) is the thing that
   * decides whether a pair is usable, and it reports `unchecked` for a malformed one.
   * Refusing the whole workbook over a mistyped sort code would be the wrong trade.
   */
  bankAccountName: z.string().max(200).nullable(),
  bankSortCode: z.string().max(20).nullable(),
  bankAccountNumber: z.string().max(20).nullable(),
})

export const PaymentRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  reference: z.string().min(1).max(120),
  dueDate: isoDate,
  // Non-negative, like both money columns on the Grants sheet. A clawback keyed as
  // "(5,000)" used to import as an instalment of minus five thousand pounds, which
  // nothing else in Custodian can produce and which quietly reduced the paid and
  // outstanding totals on Finance. Refused on the review screen too (`parsePayments`).
  amount: z.number().finite().min(0).max(1_000_000_000),
  paid: z.boolean(),
  paidDate: isoDate.nullable(),
})

export const ReportRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  reference: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
  dueDate: isoDate,
  received: z.boolean(),
  receivedDate: isoDate.nullable(),
})

export const CellIssueSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  column: z.string().max(200),
  message: z.string().max(500),
  /** Three sheets share column names, so an issue without this names no place to look. */
  sheet: z.enum(['grants', 'payments', 'reports']),
  /** Set where a GRANT row was dropped: what its payments and reports point at. */
  reference: z.string().max(120).optional(),
})

/**
 * A whole workbook. The grant cap is the same number the review screen enforces as a
 * blocker (`MAX_GRANTS_PER_IMPORT`), and it is what the write path was MEASURED to do:
 * every row is committed in one `db.batch` under a 4-second timeout. The door repeats
 * the blocker rather than trusting it, since the blocker runs in a browser.
 *
 * The payment and report caps stay a denial-of-service guard rather than a product
 * limit: they are narrower rows, and a workbook large enough to strain them would have
 * been stopped by the grant cap first.
 */
export const ImportPayloadSchema = z.object({
  grants: z.array(GrantRowSchema).max(MAX_GRANTS_PER_IMPORT),
  payments: z.array(PaymentRowSchema).max(20000),
  reports: z.array(ReportRowSchema).max(20000),
  cellIssues: z.array(CellIssueSchema).max(5000),
})

/**
 * The programme and round names the client confirmed on the review screen, mapped to
 * what they actually are. `null` for a round means "create it" — historic rounds are
 * essentially labels, and making someone hand-create eleven of them before they can
 * upload is a pointless gate. Programmes carry impact units, goals and strategy, so
 * they are never created here.
 */
export const ImportMappingSchema = z.object({
  programmes: z.record(z.string().max(300), z.uuid()),
  rounds: z.record(z.string().max(300), z.uuid().nullable()),
  /**
   * Each distinct Themes value in the file → the theme it is, or `null` for "leave it
   * out". Themes are never created here either: a programme's list is set on the
   * programme, and an import that invented themes would bypass that.
   */
  themes: z.record(z.string().max(100), z.string().max(100).nullable()),
})

export const CommitImportSchema = z.object({
  payload: ImportPayloadSchema,
  mapping: ImportMappingSchema,
  fileName: z.string().max(300).nullable(),
  /** Degradation codes the client saw and accepted, recorded on the batch. */
  acceptedWarnings: z.array(z.string().max(120)).max(100),
})

export type ImportPayload = z.infer<typeof ImportPayloadSchema>
export type ImportMapping = z.infer<typeof ImportMappingSchema>
