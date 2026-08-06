import { z } from 'zod'

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
  status: z.enum(['active', 'completed', 'cancelled']),
  charityNumber: z.string().max(60).nullable(),
  companyNumber: z.string().max(60).nullable(),
  contactEmail: z.string().max(320).nullable(),
  deliveryArea: z.string().max(300).nullable(),
  purpose: z.string().max(2000).nullable(),
  endDate: isoDate.nullable(),
  impactQuantity: z.number().finite().min(0).nullable(),
})

export const PaymentRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  reference: z.string().min(1).max(120),
  dueDate: isoDate.nullable(),
  amount: z.number().finite().max(1_000_000_000),
  paid: z.boolean(),
  paidDate: isoDate.nullable(),
})

export const ReportRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  reference: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
  dueDate: isoDate,
  receivedDate: isoDate.nullable(),
})

export const CellIssueSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  column: z.string().max(200),
  message: z.string().max(500),
})

/**
 * A whole workbook. The row caps are a denial-of-service guard rather than a product
 * limit — a foundation with more than this many historic grants should be talked
 * through splitting the file, not silently truncated.
 */
export const ImportPayloadSchema = z.object({
  grants: z.array(GrantRowSchema).max(5000),
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
