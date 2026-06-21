// ─── Custodian score: prompt builders ────────────────────────────────────────
//
// Two pure string builders, split deliberately for prompt caching:
//
//   • buildSystemPrompt()  — the rubric + instructions. Identical for every
//     application, so it sits in `system` behind a cache breakpoint.
//   • buildUserPrompt()    — the funder context + the specific application.
//     Volatile, so it goes in the user turn after the cached prefix.
//
// Keeping them pure means the exact text the model sees is unit-testable and
// reviewable without making an API call.

import { CRITERION_DEFINITIONS, CRITERION_ORDER } from './definitions'
import type { CustodianScoreInput } from './types'

/**
 * The scoring rubric and instructions. Stable across all applications — change
 * this and you change every score, so treat edits as a scoring-policy change.
 */
export function buildSystemPrompt(): string {
  const rubric = CRITERION_ORDER.map((key) => {
    const def = CRITERION_DEFINITIONS[key]
    return `- **${def.label}** (\`${key}\`): ${def.description}`
  }).join('\n')

  return `You are an assessor for a UK grant-making foundation. Your job is to evaluate a grant application against the funder's mission and the specific programme it was submitted to, then score it.

You will be given the funder's mission statement, the programme's goal, and the application itself (the applicant organisation, the amount requested, and their answers to the application form).

Score the application on each of the following criteria from 1 (poor) to 10 (excellent). For each, give a one-sentence rationale grounded in what the application actually says — do not invent facts that are not present.

${rubric}

Then write a short assessment summary (2-4 sentences) for the grant officer, and list any specific concerns a reviewer should check before deciding.

Scoring guidance — read carefully, as consistency matters more than generosity:
- Anchor every score to the mission and programme goal. Strong work that does not advance the funder's mission is a weak application here, and must score low on strategic alignment.
- Use the full 1-10 range. Reserve 9-10 for genuinely exceptional, fully-evidenced cases and 1-3 for applications with serious deficiencies. Most credible applications land in the 5-8 range.
- Judge only on the evidence provided. Where the application is silent or vague on a criterion, that is itself a weakness — score it lower and say so in the rationale, rather than giving the benefit of the doubt.
- Be specific and consistent: two applications of equal merit should receive equal scores. Do not inflate scores to be encouraging.

Return your assessment in the exact structured format requested.`
}

/** The funder context and the specific application. Changes per application. */
export function buildUserPrompt(input: CustodianScoreInput): string {
  const mission = input.missionStatement?.trim() || '(no mission statement on file)'
  const goal = input.programmeGoal?.trim() || '(no specific goal recorded for this programme)'
  const description = input.programmeDescription?.trim()

  const responses = (input.responses ?? [])
    .filter((r) => r.value?.trim())
    .map((r) => `### ${r.label}\n${r.value.trim()}`)
    .join('\n\n')

  // Structured application fields, each shown only when present. Bank details are
  // deliberately excluded — they carry no scoring signal and are sensitive.
  const fields = [
    ['Geography / location', input.geography],
    ['Registered charity number', input.charityNumber],
    ['Companies House number', input.companyNumber],
  ]
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([label, v]) => `${label}: ${(v as string).trim()}`)
    .join('\n')

  return `# Funder mission
${mission}

# Programme: ${input.programmeName}
Goal: ${goal}${description ? `\nDescription: ${description}` : ''}

# Application
Organisation: ${input.organisationName}
Amount requested: £${input.amountRequested.toLocaleString('en-GB')}${fields ? `\n${fields}` : ''}

## Application responses
${responses || '(no responses provided)'}`
}
