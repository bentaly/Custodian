// ─── Report analysis: model output schema + types ────────────────────────────
//
// Structured-output shape for the AI analysis of a submitted grant report:
// a digest, alignment against the original application's promises, alignment
// against the programme's goal, and the impact quantity extracted in the
// programme's impact unit.

import { z } from 'zod'

export const ReportAnalysisOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'A 2-4 sentence digest of the report for a grant officer: what was delivered and the headline impact.',
    ),
  applicationAlignment: z
    .object({
      score: z
        .number()
        .min(1)
        .max(10)
        .describe('1-10: how fully the report shows the application\'s promises were delivered.'),
      narrative: z
        .string()
        .describe('2-3 sentences on whether the grantee did what the application said they would.'),
      promisesKept: z
        .array(z.string())
        .describe('Specific commitments from the application the report evidences as delivered.'),
      promisesUnmet: z
        .array(z.string())
        .describe(
          'Specific commitments from the application the report does not evidence, or reports as undelivered.',
        ),
    })
    .nullable()
    .describe('Null when no original application was provided to compare against.'),
  programmeAlignment: z.object({
    score: z
      .number()
      .min(1)
      .max(10)
      .describe("1-10: how well the reported work advances the programme's goal."),
    narrative: z.string().describe("2-3 sentences on fit with the programme's goal."),
  }),
  challengesSummary: z
    .string()
    .nullable()
    .describe(
      'A 1-3 sentence summary of the challenges the grantee faced and how they were (or were not) overcome, drawn from ANYWHERE in the report. Null if the report genuinely mentions no challenges.',
    ),
  lessonsSummary: z
    .string()
    .nullable()
    .describe(
      'A 1-3 sentence summary of the lessons the grantee learned from delivery, drawn from ANYWHERE in the report. Null if the report genuinely mentions no learnings.',
    ),
  impactQuantity: z.object({
    found: z.boolean().describe('Whether the report evidences a quantity in the requested unit.'),
    value: z
      .number()
      .nullable()
      .describe('The quantity in the requested unit, or null if none is evidenced. NEVER guess.'),
    quote: z
      .string()
      .nullable()
      .describe('Verbatim snippet from the report that states or supports the quantity.'),
    confidence: z.number().min(0).max(1).describe('Confidence the extracted value is correct.'),
  }),
  flags: z
    .array(z.string())
    .describe(
      'Concerns a grant officer should check: discrepancies with the grant amount, unspent funds, undelivered work, safeguarding issues, etc. Empty if none.',
    ),
})

export type ReportAnalysisOutput = z.infer<typeof ReportAnalysisOutputSchema>

export interface ReportAnalysisResult {
  status: 'pending' | 'analysed' | 'error'
  output: ReportAnalysisOutput | null
  /** Model + error detail persisted alongside the output (mirrors custodianScoreDetail). */
  detail: Record<string, unknown> | null
  analysedAt: string
}
