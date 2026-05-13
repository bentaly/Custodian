import { z } from 'zod'

export const CreateFundSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
})
export type CreateFundInput = z.infer<typeof CreateFundSchema>

export const UpdateFundSchema = CreateFundSchema.partial().extend({
  id: z.string().cuid(),
})
export type UpdateFundInput = z.infer<typeof UpdateFundSchema>

export const CreateProgrammeSchema = z.object({
  fundId: z.string().cuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  openDate: z.coerce.date().optional(),
  closeDate: z.coerce.date().optional(),
  budgetPence: z.number().int().min(0).optional(),
})
export type CreateProgrammeInput = z.infer<typeof CreateProgrammeSchema>
