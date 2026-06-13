// ─── Custodian score: orchestrator ───────────────────────────────────────────
//
// Builds the prompts, calls the model with structured output, validates the
// result, and rolls the sub-scores up into the 0–100 composite. The model call
// is injected via `assess` so this is fully unit-testable without the network.
//
// Mirrors the due-diligence orchestrator's contract: it NEVER throws. Any
// failure (missing key, API error, malformed output) is surfaced as a status
// on the returned result so the submission path is never blocked by scoring.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  CustodianScoreOutputSchema,
  buildSystemPrompt,
  buildUserPrompt,
  computeComposite,
  CRITERION_ORDER,
  type CustodianScoreInput,
  type CustodianScoreOutput,
  type CustodianScoreResult,
} from '../../lib/custodianScore'
import { getAnthropic, isAnthropicConfigured, SCORING_MODEL } from './client'

/** The model call, injectable for tests. Returns schema-valid structured output. */
export type CustodianScoreAssessor = (input: CustodianScoreInput) => Promise<CustodianScoreOutput>

export interface RunOptions {
  assess?: CustodianScoreAssessor
  /** Injectable clock for deterministic tests. */
  now?: Date
}

/**
 * The live assessor: one structured-output call to Claude. The rubric/system
 * prompt is marked for caching — it's identical across every application, so
 * back-to-back scoring (the backfill script, or a burst of submissions) reuses
 * the cached prefix at ~0.1x input cost.
 */
export const liveAssessor: CustodianScoreAssessor = async (input) => {
  const message = await getAnthropic().messages.parse({
    model: SCORING_MODEL,
    max_tokens: 8000,
    // Adaptive thinking improves the consistency of the judgement; the model
    // decides how much to deliberate per application.
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: { format: zodOutputFormat(CustodianScoreOutputSchema) },
  })

  if (!message.parsed_output) {
    // stop_reason: 'refusal' | 'max_tokens' leaves parsed_output null.
    throw new Error(`model returned no parsed output (stop_reason: ${message.stop_reason})`)
  }
  return message.parsed_output
}

export async function runCustodianScore(
  input: CustodianScoreInput,
  opts: RunOptions = {},
): Promise<CustodianScoreResult> {
  const now = opts.now ?? new Date()
  const scoredAt = now.toISOString()

  // Not configured yet → leave as pending (re-runnable) rather than erroring.
  if (!opts.assess && !isAnthropicConfigured()) {
    return { status: 'pending', score: null, detail: null, scoredAt }
  }

  const assess = opts.assess ?? liveAssessor

  try {
    const output = await assess(input)

    // Defensive: ensure every expected criterion is present before computing.
    for (const key of CRITERION_ORDER) {
      if (!output.criteria[key]) throw new Error(`missing criterion in model output: ${key}`)
    }

    const score = computeComposite(output.criteria)
    return {
      status: 'scored',
      score,
      detail: {
        criteria: output.criteria,
        summary: output.summary,
        flags: output.flags ?? [],
        model: SCORING_MODEL,
      },
      scoredAt,
    }
  } catch (e) {
    return {
      status: 'error',
      score: null,
      detail: {
        criteria: {} as CustodianScoreOutput['criteria'],
        summary: '',
        flags: [],
        model: SCORING_MODEL,
        error: e instanceof Error ? e.message : String(e),
      },
      scoredAt,
    }
  }
}
