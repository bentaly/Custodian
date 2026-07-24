import { z } from 'zod'

export const ApplicationStatus = z.enum([
  'for_review',
  'shortlisted',
  'awarded',
  'declined',
])
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

// A single project-budget line. `amount` is in pounds (GBP) to the penny —
// decimals allowed — consistent with `amountRequested`/`amountAwarded`, which are
// `numeric`, not minor units. `details` preserves any further fields the
// foundation captured on the line beyond item and amount (we keep but don't
// interpret them — see budget/types.ts).
export const BudgetLineSchema = z.object({
  item: z.string().min(1).max(255),
  amount: z.number().positive(),
  details: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .max(50)
    .optional(),
})

export const CreateApplicationSchema = z.object({
  roundProgrammeId: z.uuid(),
  // The foundation's own application reference, when the application arrives via
  // the field-mapping ingest path. Optional so direct (canonical) submissions
  // still validate without one.
  externalApplicationId: z.string().min(1).max(255).optional(),
  organisationName: z.string().min(1).max(255),
  // Both optional — an applicant may hold a charity number, a company number,
  // or both. Due diligence routing keys off whichever are present.
  charityNumber: z.string().max(50).optional(),
  companyNumber: z.string().max(50).optional(),
  // Free-text area where the project is delivered (community served). Optional.
  deliveryArea: z.string().max(255).optional(),
  bankName: z.string().min(1).max(255),
  bankAccountName: z.string().min(1).max(255),
  bankAccountNumber: z.string().min(1).max(50),
  bankSortCode: z.string().min(1).max(20),
  amountRequested: z.number().positive(),
  // The impact the applicant proposes to achieve, in the programme's impact unit
  // (people / trees / hectares …). Optional — not every foundation collects it.
  proposedImpactQuantity: z.number().min(0).max(1_000_000_000).optional(),
  // The project budget as line items. Optional — not every foundation collects
  // one. Deliberately NOT reconciled against `amountRequested`: the applicant may
  // be asking this funder for only part of the budget, so the lines legitimately
  // sum to more (or less) than the ask.
  budgetBreakdown: z.array(BudgetLineSchema).max(100).optional(),
  responses: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
})
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>

export const UpdateApplicationStatusSchema = z.object({
  id: z.uuid(),
  status: ApplicationStatus,
})
export type UpdateApplicationStatusInput = z.infer<typeof UpdateApplicationStatusSchema>

export const GenerateAwardSchema = z.object({
  id: z.uuid(),
  amountAwarded: z.number().positive(),
  schedule: z
    .array(
      z.object({
        instalment: z.number().int().positive(),
        amount: z.number().positive(),
        // ISO yyyy-mm-dd, or null for "date TBC".
        date: z.string().min(1).nullable(),
      }),
    )
    .min(1),
  reportingDates: z.array(
    z.object({
      label: z.string().min(1),
      date: z.string().min(1),
    }),
  ),
})
export type GenerateAwardInput = z.infer<typeof GenerateAwardSchema>

export const ScoreBand = z.enum(['90plus', '80to89', '70to79', 'below70'])
export type ScoreBand = z.infer<typeof ScoreBand>

export const ApplicationFiltersSchema = z.object({
  programmeId: z.uuid().optional(),
  roundId: z.uuid().optional(),
  status: ApplicationStatus.optional(),
  // Free-text search over the organisation name.
  q: z.string().trim().min(1).max(255).optional(),
  // AI ("Custodian") composite score band; only matches scored applications.
  scoreBand: ScoreBand.optional(),
  // Programme tag/theme — matches applications whose programme carries the tag.
  tag: z.string().min(1).max(100).optional(),
  // Column sort. Only base-table columns are sortable; programme/theme are the
  // grouping (tabs) and filter axes.
  sortBy: z.enum(['organisation', 'amount', 'status', 'score', 'dueDiligence']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1),
  // Cap is high enough to cover a whole-programme CSV export in one call.
  pageSize: z.number().int().min(1).max(10_000).default(25),
})
export type ApplicationFilters = z.infer<typeof ApplicationFiltersSchema>
