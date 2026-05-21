import { z } from 'zod'

export const CreateFoundationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  website: z.string().url().optional(),
})
export type CreateFoundationInput = z.infer<typeof CreateFoundationSchema>

export const UpdateFoundationSchema = CreateFoundationSchema.partial().extend({
  id: z.string().uuid(),
})
export type UpdateFoundationInput = z.infer<typeof UpdateFoundationSchema>
