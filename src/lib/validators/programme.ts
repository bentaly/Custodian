import { z } from 'zod'

export const CreateProgrammeSchema = z.object({
  clientId: z.uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  goal: z.string().optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
  budget: z.number().positive().optional(),
  maxGrantAmount: z.number().positive().optional(),
  grantDurationYears: z.number().int().min(1).max(20).optional(),
})
export type CreateProgrammeInput = z.infer<typeof CreateProgrammeSchema>

export const UpdateProgrammeSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  goal: z.string().optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
  budget: z.number().positive().optional(),
  maxGrantAmount: z.number().positive().optional(),
  grantDurationYears: z.number().int().min(1).max(20).optional(),
})
export type UpdateProgrammeInput = z.infer<typeof UpdateProgrammeSchema>
