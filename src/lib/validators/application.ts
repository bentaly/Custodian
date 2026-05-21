import { z } from 'zod'

export const ApplicationStatus = z.enum([
  'submitted',
  'under_review',
  'shortlisted',
  'approved',
  'declined',
  'withdrawn',
])
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

export const CreateApplicationSchema = z.object({
  roundId: z.string().uuid(),
  organisationName: z.string().min(1).max(255),
  charityNumber: z.string().max(50).optional(),
  contactName: z.string().min(1).max(255),
  contactEmail: z.string().email(),
  amountRequested: z.number().positive(),
  responses: z.record(z.string().uuid(), z.string()),
})
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>

export const UpdateApplicationStatusSchema = z.object({
  id: z.string().uuid(),
  status: ApplicationStatus,
  amountAwarded: z.number().positive().optional(),
})
export type UpdateApplicationStatusInput = z.infer<typeof UpdateApplicationStatusSchema>

export const ApplicationFiltersSchema = z.object({
  roundId: z.string().uuid().optional(),
  programmeId: z.string().uuid().optional(),
  status: ApplicationStatus.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})
export type ApplicationFilters = z.infer<typeof ApplicationFiltersSchema>
