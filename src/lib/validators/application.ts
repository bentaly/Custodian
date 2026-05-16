import { z } from 'zod'

export const ApplicationStatus = z.enum([
  'RECEIVED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'AWARDED',
  'DECLINED',
])
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

export const CreateApplicationSchema = z.object({
  programmeId: z.string().min(1),
  organisationId: z.string().min(1),
  submittedAt: z.coerce.date().optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(5000).optional(),
})
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>

export const UpdateApplicationStatusSchema = z.object({
  id: z.string().min(1),
  status: ApplicationStatus,
  notes: z.string().max(2000).optional(),
})
export type UpdateApplicationStatusInput = z.infer<typeof UpdateApplicationStatusSchema>

export const ApplicationFiltersSchema = z.object({
  programmeId: z.string().min(1).optional(),
  fundId: z.string().min(1).optional(),
  status: ApplicationStatus.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})
export type ApplicationFilters = z.infer<typeof ApplicationFiltersSchema>
