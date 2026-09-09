// ─── Portfolio analysis: model output schema ─────────────────────────────────
//
// Deliberately small. The Figma design is one paragraph in a banner above the
// charts, and the discipline of three sentences is doing real work: it forces the
// model to pick its best point rather than list every true thing it noticed, which
// is what turns a summary into a restatement of the panels underneath it.
//
// The two array fields are not shown to anybody. They exist so the paragraph can be
// checked (`verify.ts`) and so its quality can be judged while the prompt is being
// tuned — "which figures did it reach for, and which part of the strategy did it
// think it was measuring?" is the question a dry run needs answered.

import { z } from 'zod'

export const PortfolioAnalysisOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'The portfolio summary: at most three sentences and 70 words, in British English. ' +
        'Every figure written as a numeral, copied verbatim from the brief.',
    ),
  figuresCited: z
    .array(z.string())
    .describe(
      'The dotted path of every figure used in the summary, e.g. "portfolio.committed" or ' +
        '"deprivation.shareOfMoneyInDeciles1to4". One entry per figure quoted.',
    ),
  strategyPointsUsed: z
    .array(z.string())
    .describe(
      'Short quotes from the giving strategy the summary measured the portfolio against. ' +
        'Empty when the foundation has set no strategy.',
    ),
})

export type PortfolioAnalysisOutput = z.infer<typeof PortfolioAnalysisOutputSchema>

export interface PortfolioAnalysisResult {
  status: 'pending' | 'analysed' | 'error'
  output: PortfolioAnalysisOutput | null
  /** Model id, token usage, and the error or verification failure when there is one. */
  detail: Record<string, unknown> | null
  generatedAt: string
}
