// ─── Portfolio analysis: orchestrator ────────────────────────────────────────
//
// One structured-output call summarising a foundation's whole portfolio against
// its own giving strategy, then a verification pass, then one row.
//
// Mirrors the contract the Custodian score and the report analysis both hold to:
// it NEVER throws. A missing API key is `pending` (re-runnable, nothing is wrong);
// a model error or a failed verification is `error`. Neither is allowed to be the
// reason a queue message retries, because retrying will produce the same outcome
// three more times and then fill the dead-letter queue with it.
//
// The verification pass is the part worth defending. A model that invents "£1.2m"
// has produced something indistinguishable, on a board-facing screen, from a figure
// we computed — so a summary carrying any numeral the brief does not contain is
// discarded, recorded as an error with the offending figures, and the paragraph
// already on screen is left alone. A stale correct paragraph beats a fresh wrong one.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  PortfolioAnalysisOutputSchema,
  buildSystemPrompt,
  buildUserPrompt,
  verifySummary,
  type PortfolioAnalysisOutput,
  type PortfolioAnalysisResult,
  type PortfolioBrief,
} from '../../lib/portfolioAnalysis'
import { getAnthropic, isAnthropicConfigured, SCORING_MODEL } from '../custodianScore/client'

export type PortfolioAssessor = (
  brief: PortfolioBrief,
) => Promise<{ output: PortfolioAnalysisOutput; usage?: Record<string, unknown> }>

export interface RunPortfolioAnalysisOptions {
  assess?: PortfolioAssessor
  /** Injectable clock for deterministic tests. */
  now?: Date
}

export const liveAssessor: PortfolioAssessor = async (brief) => {
  const message = await getAnthropic().messages.parse({
    model: SCORING_MODEL,
    // Thinking tokens count against `max_tokens`, and the visible output here is three
    // sentences. At 4,000 the model spent the whole budget reasoning and returned
    // `stop_reason: max_tokens` with nothing parsed — a failure that looks like a model
    // error and is actually a ceiling. Headroom is free: only what is generated is billed.
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    // Adaptive thinking defaults to `high`, which on this task is most of the cost — a
    // few thousand thinking tokens to write 60 words. The judgement wanted is "which of
    // these forty figures is worth a sentence", not a hard reasoning problem, and
    // `medium` reaches it for roughly half the spend.
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(PortfolioAnalysisOutputSchema),
    },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserPrompt(brief) }],
  })
  if (!message.parsed_output) {
    throw new Error(`model returned no parsed output (stop_reason: ${message.stop_reason})`)
  }
  return {
    output: message.parsed_output,
    usage: message.usage as unknown as Record<string, unknown>,
  }
}

export async function runPortfolioAnalysis(
  brief: PortfolioBrief,
  opts: RunPortfolioAnalysisOptions = {},
): Promise<PortfolioAnalysisResult> {
  const generatedAt = (opts.now ?? new Date()).toISOString()

  if (!opts.assess && !isAnthropicConfigured()) {
    return { status: 'pending', output: null, detail: null, generatedAt }
  }

  const assess = opts.assess ?? liveAssessor
  let output: PortfolioAnalysisOutput
  let usage: Record<string, unknown> | undefined
  try {
    const result = await assess(brief)
    output = result.output
    usage = result.usage
  } catch (e) {
    return {
      status: 'error',
      output: null,
      detail: { model: SCORING_MODEL, error: e instanceof Error ? e.message : String(e) },
      generatedAt,
    }
  }

  const failure = verifySummary(output.summary, output.figuresCited, brief)
  if (failure) {
    return {
      status: 'error',
      output: null,
      detail: {
        model: SCORING_MODEL,
        usage,
        error: 'summary cited figures that are not in the brief',
        ...failure,
        // Kept so a rejected paragraph can be read back and the prompt tightened
        // against the actual failure, rather than against a guess at it.
        rejectedSummary: output.summary,
      },
      generatedAt,
    }
  }

  return {
    status: 'analysed',
    output,
    detail: { model: SCORING_MODEL, usage, strategyPointsUsed: output.strategyPointsUsed },
    generatedAt,
  }
}
