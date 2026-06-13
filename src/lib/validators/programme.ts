import { z } from 'zod'

export const CreateProgrammeSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  goal: z.string().optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
})
export type CreateProgrammeInput = z.infer<typeof CreateProgrammeSchema>

export const UpdateProgrammeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  goal: z.string().optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
})
export type UpdateProgrammeInput = z.infer<typeof UpdateProgrammeSchema>
