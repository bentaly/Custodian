import { z } from 'zod'

export const CreateRoundSchema = z.object({
  clientId: z.uuid(),
  name: z.string().min(1).max(255),
  openedAt: z.string().min(1),
  closedAt: z.string().min(1),
})
export type CreateRoundInput = z.infer<typeof CreateRoundSchema>

export const UpdateRoundSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255).optional(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
})
export type UpdateRoundInput = z.infer<typeof UpdateRoundSchema>
