import { z } from 'zod'

export const ApplicationStatus = z.enum([
  'for_review',
  'shortlisted',
  'awarded',
  'declined',
])
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

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
  bankName: z.string().min(1).max(255),
  bankAccountName: z.string().min(1).max(255),
  bankAccountNumber: z.string().min(1).max(50),
  bankSortCode: z.string().min(1).max(20),
  amountRequested: z.number().positive(),
  responses: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
})
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>

export const UpdateApplicationStatusSchema = z.object({
  id: z.uuid(),
  status: ApplicationStatus,
  amountAwarded: z.number().positive().optional(),
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
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})
export type ApplicationFilters = z.infer<typeof ApplicationFiltersSchema>
