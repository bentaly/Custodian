// ─── Report analysis: orchestrator ───────────────────────────────────────────
//
// One structured-output call analysing a submitted grant report: digest,
// alignment against the application's promises, alignment against the
// programme's goal, and impact-quantity extraction in the programme's unit.
// Mirrors the Custodian-score runner's contract: it NEVER throws — missing key
// → pending (re-runnable), model error → error status. Report creation is never
// blocked by analysis.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  ReportAnalysisOutputSchema,
  buildSystemPrompt,
  buildUserPrompt,
  type ReportAnalysisInput,
  type ReportAnalysisOutput,
  type ReportAnalysisResult,
} from '../../lib/reportAnalysis'
import { getAnthropic, isAnthropicConfigured, SCORING_MODEL } from '../custodianScore/client'

export type ReportAnalysisAssessor = (input: ReportAnalysisInput) => Promise<ReportAnalysisOutput>

export interface RunReportAnalysisOptions {
  assess?: ReportAnalysisAssessor
  /** Injectable clock for deterministic tests. */
  now?: Date
}

export const liveAssessor: ReportAnalysisAssessor = async (input) => {
  const message = await getAnthropic().messages.parse({
    model: SCORING_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: { format: zodOutputFormat(ReportAnalysisOutputSchema) },
  })
  if (!message.parsed_output) {
    throw new Error(`model returned no parsed output (stop_reason: ${message.stop_reason})`)
  }
  return message.parsed_output
}

export async function runReportAnalysis(
  input: ReportAnalysisInput,
  opts: RunReportAnalysisOptions = {},
): Promise<ReportAnalysisResult> {
  const now = opts.now ?? new Date()
  const analysedAt = now.toISOString()

  if (!opts.assess && !isAnthropicConfigured()) {
    return { status: 'pending', output: null, detail: null, analysedAt }
  }

  const assess = opts.assess ?? liveAssessor
  try {
    const output = await assess(input)
    return {
      status: 'analysed',
      output,
      detail: { model: SCORING_MODEL, flags: output.flags },
      analysedAt,
    }
  } catch (e) {
    return {
      status: 'error',
      output: null,
      detail: { model: SCORING_MODEL, error: e instanceof Error ? e.message : String(e) },
      analysedAt,
    }
  }
}
