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
import { budgetTotal, formatPounds } from '../budget'

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

Separately, state the grant purpose: one or two sentences saying what the money would actually fund. This is NOT part of your assessment — it makes no judgement at all:
- Say who the applicant is, what they will do, for whom, where, and over what period, as far as the application states them. Omit any of those the application does not give rather than guessing.
- Write it as a complete sentence beginning with the organisation's name, e.g. "Bradford Youth Trust will run six employability courses for 90 unemployed 16-24 year olds across Bradford over 12 months."
- Keep it to 40 words or fewer. Name the core activity and who it reaches; leave out subsidiary activities, delivery detail and anything an applicant lists as part of the wider project. It is a description, not an inventory.
- Do NOT restate the amount requested or name the funder or programme. It is read directly beneath the amount, so repeating it there is redundant.
- Use plain factual language. No evaluation, praise, hedging or scoring words ("strong", "well-evidenced", "promising"), and no reference to the assessment or this scoring exercise.
- If the application says too little to describe the work, say so plainly in one sentence rather than inventing detail.

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
    ['Project delivery area', input.deliveryArea],
    ['Registered charity number', input.charityNumber],
    ['Companies House number', input.companyNumber],
  ]
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([label, v]) => `${label}: ${(v as string).trim()}`)
    .join('\n')

  // The project budget, when captured. The total is stated alongside the ask
  // rather than left for the model to add up, and the prompt is explicit that a
  // mismatch is not a defect — otherwise the model reads "budget > ask" as an
  // inconsistency and marks the application down for it.
  const lines = input.budgetBreakdown ?? []
  const budget = lines.length
    ? `\n\n## Project budget\n${lines
        .map(
          (l) =>
            `- ${l.item}: ${formatPounds(l.amount)}` +
            (l.details?.length
              ? ` (${l.details.map((d) => `${d.label}: ${d.value}`).join('; ')})`
              : ''),
        )
        .join('\n')}\nTotal project budget: ${formatPounds(
        budgetTotal(lines),
      )}\n(This is the cost of the whole project. It need not equal the amount requested — ` +
      `the applicant may be asking this funder to fund only part of it, with the remainder matched ` +
      `or secured elsewhere. Do not treat a difference between the two as an error or inconsistency.)`
    : input.budgetBreakdownLink
      ? // The budget exists but as a file we cannot read. Left unsaid, `budget_quality`
        // ("penalise vague, padded, or poorly justified costs") marks the application
        // down for an omission the applicant never made — their form asked for an
        // upload, not fields. But the opposite instruction is worse: told to disregard
        // it, the model credits a budget it has not seen, and a rigorous spreadsheet
        // scores the same as a blank one. So: neither penalise nor assume, and say so
        // in the rationale, which an admin reads beside the document itself.
        `\n\n## Project budget\nThe applicant supplied their budget as an attached document, which is NOT ` +
        `available to you. This foundation's form asked for a file rather than itemised fields, so the ` +
        `absence of a breakdown here is not an omission by the applicant: do not treat the budget as ` +
        `missing, vague or unjustified. Equally, do not assume the document is thorough or well ` +
        `costed — you have not seen it. Score budget quality only on the evidence you do have (the ` +
        `amount requested against the scale and ambition described), and state in your reasoning that ` +
        `the budget document was not reviewed.`
      : ''

  return `# Funder mission
${mission}

# Programme: ${input.programmeName}
Goal: ${goal}${description ? `\nDescription: ${description}` : ''}

# Application
Organisation: ${input.organisationName}
Amount requested: £${input.amountRequested.toLocaleString('en-GB')}${fields ? `\n${fields}` : ''}${budget}

## Application responses
${responses || '(no responses provided)'}`
}
