import { z } from 'zod'

export const CreateRoundSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(255),
  budget: z.number().positive().optional(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
})
export type CreateRoundInput = z.infer<typeof CreateRoundSchema>

export const UpdateRoundSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  budget: z.number().positive().optional(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
})
export type UpdateRoundInput = z.infer<typeof UpdateRoundSchema>
