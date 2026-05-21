import { z } from 'zod'

export const FieldType = z.enum([
  'text',
  'textarea',
  'number',
  'select',
  'multi_select',
  'date',
  'file',
  'checkbox',
])
export type FieldType = z.infer<typeof FieldType>

export const CreateFormFieldSchema = z.object({
  programmeId: z.string().uuid(),
  label: z.string().min(1).max(255),
  fieldType: FieldType,
  displayOrder: z.number().int().min(0).default(0),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1)).optional(),
})
export type CreateFormFieldInput = z.infer<typeof CreateFormFieldSchema>

export const UpdateFormFieldSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(255).optional(),
  fieldType: FieldType.optional(),
  displayOrder: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(),
})
export type UpdateFormFieldInput = z.infer<typeof UpdateFormFieldSchema>
