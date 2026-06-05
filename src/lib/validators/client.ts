import { z } from 'zod'

export const ClientType = z.enum(['charitable_foundation', 'family_office'])
export type ClientType = z.infer<typeof ClientType>

export const CreateClientSchema = z.object({
  name: z.string().min(1).max(255),
  type: ClientType.default('charitable_foundation'),
  description: z.string().max(2000).optional(),
  website: z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
})
export type CreateClientInput = z.infer<typeof CreateClientSchema>

export const UpdateClientSchema = CreateClientSchema.partial().extend({
  id: z.string().uuid(),
})
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>
