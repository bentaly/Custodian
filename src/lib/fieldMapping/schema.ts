// ─── Field mapping: model output schema ──────────────────────────────────────
//
// Structured-output shape for the AI fallback. The model returns one proposal per
// canonical field it was asked about: the best-matching payload key (or null) and
// a 0–1 confidence. The confidence threshold is applied by the orchestrator, not
// the model.

import { z } from 'zod'

export const FieldProposalSchema = z.object({
  canonicalField: z
    .string()
    .describe('The canonical field key this proposal is for, exactly as given in the prompt.'),
  sourceKey: z
    .string()
    .nullable()
    .describe('The payload key whose value best fills this field, or null if none is a confident match.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence from 0 to 1 that this payload key maps to this canonical field.'),
})

export const FieldMappingOutputSchema = z.object({
  proposals: z
    .array(FieldProposalSchema)
    .describe('Exactly one entry per canonical field you were asked to map.'),
})

export type FieldMappingOutput = z.infer<typeof FieldMappingOutputSchema>
