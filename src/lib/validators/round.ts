import { z } from 'zod'

export const RoundStatus = z.enum(['upcoming', 'open', 'reviewing', 'closed'])
export type RoundStatus = z.infer<typeof RoundStatus>

export const CreateRoundSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(255),
  budget: z.number().positive().optional(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
})
export type CreateRoundInput = z.infer<typeof CreateRoundSchema>

export const UpdateRoundStatusSchema = z.object({
  id: z.string().uuid(),
  status: RoundStatus,
})
export type UpdateRoundStatusInput = z.infer<typeof UpdateRoundStatusSchema>

export const UpdateRoundSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  budget: z.number().positive().optional(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
})
export type UpdateRoundInput = z.infer<typeof UpdateRoundSchema>
