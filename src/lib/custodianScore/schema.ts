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
  grantPurpose: z
    .string()
    .describe(
      'One or two sentences, 40 words or fewer, stating what the money would fund: who the applicant is, what they will do, for whom, where, and over what period — drawn only from the application. A statement of fact with no judgement, praise or scoring language, written as a complete sentence starting with the organisation name. Never restates the amount requested.',
    ),
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

export type CustodianScoreOutput = z.infer<typeof CustodianScoreOutputSchema> & {
  /** Present only when the programme offered themes to choose from. */
  themes?: string[]
}

/**
 * The schema for one application: the fixed shape above, plus `themes` as an array of
 * an ENUM of that programme's own themes, so the model cannot return a theme the
 * programme does not have — not even a near-spelling. Built per request because the
 * list is per programme.
 *
 * "At least one" is NOT in the schema: structured outputs do not enforce array length
 * (the SDK strips it and would then reject the whole assessment client-side over it).
 * The prompt asks for at least one and `assignedThemes` tidies what comes back.
 *
 * A programme with no themes gets the plain schema — an empty enum is not a schema.
 */
export function custodianScoreOutputSchemaFor(programmeThemes: readonly string[]) {
  const offered = offeredThemes(programmeThemes)
  if (offered.length === 0) return CustodianScoreOutputSchema
  return CustodianScoreOutputSchema.extend({
    themes: z
      .array(z.enum(offered as [string, ...string[]]))
      .describe(
        "The programme themes this application is genuinely about, chosen only from the programme's list and spelled exactly as given. At least one.",
      ),
  })
}

/** A programme's themes as offered to the model: trimmed, non-empty, de-duplicated. */
export function offeredThemes(programmeThemes: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of programmeThemes ?? []) {
    const t = raw?.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/**
 * What the model picked, reduced to themes the programme really has, in the
 * PROGRAMME's order (so two applications with the same themes read identically) and
 * spelled as the programme spells them. Matched case-insensitively as a belt to the
 * enum's braces.
 */
export function assignedThemes(
  picked: readonly string[] | null | undefined,
  programmeThemes: readonly string[] | null | undefined,
): string[] {
  const chosen = new Set((picked ?? []).map((p) => p.trim().toLowerCase()))
  return offeredThemes(programmeThemes).filter((t) => chosen.has(t.toLowerCase()))
}
