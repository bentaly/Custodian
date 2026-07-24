import { z } from 'zod'
import { IMPACT_UNIT_KEYS } from '../impactUnits'

export const CreateProgrammeSchema = z.object({
  clientId: z.uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  goal: z.string().optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
  impactUnit: z.enum(IMPACT_UNIT_KEYS as [string, ...string[]]).optional(),
  impactUnitLabel: z.string().max(200).nullable().optional(),
  targetBeneficiaries: z.number().int().min(0).max(100_000_000).nullable().optional(),
})
export type CreateProgrammeInput = z.infer<typeof CreateProgrammeSchema>

export const UpdateProgrammeSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  goal: z.string().optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
  impactUnit: z.enum(IMPACT_UNIT_KEYS as [string, ...string[]]).optional(),
  impactUnitLabel: z.string().max(200).nullable().optional(),
  targetBeneficiaries: z.number().int().min(0).max(100_000_000).nullable().optional(),
})
export type UpdateProgrammeInput = z.infer<typeof UpdateProgrammeSchema>

export const AddProgrammeToRoundSchema = z.object({
  roundId: z.uuid(),
  programmeId: z.uuid(),
  budget: z.number().positive(),
  maxGrantAmount: z.number().positive().optional(),
  grantDurationYears: z.number().int().min(1).max(20).optional(),
})
export type AddProgrammeToRoundInput = z.infer<typeof AddProgrammeToRoundSchema>

export const UpdateRoundProgrammeSchema = z.object({
  id: z.uuid(),
  budget: z.number().positive(),
  maxGrantAmount: z.number().positive().optional(),
  grantDurationYears: z.number().int().min(1).max(20).optional(),
})
export type UpdateRoundProgrammeInput = z.infer<typeof UpdateRoundProgrammeSchema>
