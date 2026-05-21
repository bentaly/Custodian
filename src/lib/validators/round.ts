import { z } from 'zod'

export const RoundStatus = z.enum(['upcoming', 'open', 'reviewing', 'closed'])
export type RoundStatus = z.infer<typeof RoundStatus>

export const CreateRoundSchema = z.object({
  programmeId: z.string().uuid(),
  name: z.string().min(1).max(255),
  budget: z.number().positive().optional(),
})
export type CreateRoundInput = z.infer<typeof CreateRoundSchema>

export const UpdateRoundStatusSchema = z.object({
  id: z.string().uuid(),
  status: RoundStatus,
})
export type UpdateRoundStatusInput = z.infer<typeof UpdateRoundStatusSchema>
