import { z } from 'zod'

export const CreateOrganisationSchema = z.object({
  name: z.string().min(1).max(255),
  charityNumber: z.string().max(50).optional(),
  companiesHouseNumber: z.string().max(50).optional(),
  website: z.string().url().optional(),
})
export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>

export const UpdateOrganisationSchema = CreateOrganisationSchema.partial().extend({
  id: z.string().cuid(),
})
export type UpdateOrganisationInput = z.infer<typeof UpdateOrganisationSchema>
