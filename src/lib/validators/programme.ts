import { z } from 'zod'

export const ProgrammeStatus = z.enum(['active', 'draft', 'closed'])
export type ProgrammeStatus = z.infer<typeof ProgrammeStatus>

export const CreateProgrammeSchema = z.object({
  foundationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
})
export type CreateProgrammeInput = z.infer<typeof CreateProgrammeSchema>

export const UpdateProgrammeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  status: ProgrammeStatus.optional(),
})
export type UpdateProgrammeInput = z.infer<typeof UpdateProgrammeSchema>
