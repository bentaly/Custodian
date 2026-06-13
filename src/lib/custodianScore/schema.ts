// ─── Custodian score: model output schema ─────────────────────────────────────
//
// The exact shape we force the model to return via structured outputs
// (output_config.format). The composite 0–100 is deliberately NOT requested —
// we compute it deterministically from the sub-scores (see computeComposite),
// so the headline number is always a faithful roll-up of the breakdown.

import { z } from 'zod'
import { CRITERION_ORDER } from './definitions'
import type { CriterionKey } from './types'

const CriterionScoreSchema = z.object({
  score: z.number().int().min(1).max(10).describe('1 (poor) to 10 (excellent).'),
  rationale: z
    .string()
    .describe('One sentence justifying the score, grounded in the application text.'),
})

// Build the per-criterion object from the registry so the schema can never
// drift out of sync with the criteria we actually define.
const criteriaShape = Object.fromEntries(
  CRITERION_ORDER.map((key) => [key, CriterionScoreSchema]),
) as Record<CriterionKey, typeof CriterionScoreSchema>

export const CustodianScoreOutputSchema = z.object({
  criteria: z.object(criteriaShape),
  summary: z
    .string()
    .describe(
      'A concise 2–4 sentence assessment summary for the grant officer. Lead with the headline judgement, then the key supporting reasons. No preamble.',
    ),
  flags: z
    .array(z.string())
    .describe(
      'Specific concerns a reviewer should check before deciding (e.g. budget irregularities, additionality questions). Empty array if none.',
    ),
})

export type CustodianScoreOutput = z.infer<typeof CustodianScoreOutputSchema>
