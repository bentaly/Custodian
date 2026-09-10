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
import { impactUnitLabel } from '../impactUnits'
import type { DeprivationNation, DeprivationResult } from '../deprivation/types'
import type { OrganisationProfile } from '../dueDiligence/types'

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
- Use ONLY what the application itself states. Deprivation deciles and charity-register figures are assessment context: they must never appear in the purpose, which describes the funded work and nothing else.

Scoring guidance — read carefully, as consistency matters more than generosity:
- Anchor every score to the mission and programme goal. Strong work that does not advance the funder's mission is a weak application here, and must score low on strategic alignment.
- Use the full 1-10 range. Reserve 9-10 for genuinely exceptional, fully-evidenced cases and 1-3 for applications with serious deficiencies. Most credible applications land in the 5-8 range.
- Judge only on the evidence provided. Where the application is silent or vague on a criterion, that is itself a weakness — score it lower and say so in the rationale, rather than giving the benefit of the doubt.
- Be specific and consistent: two applications of equal merit should receive equal scores. Do not inflate scores to be encouraging.

Reading the evidence — some of what you are given is verified and some is the applicant's own claim, and the difference matters:
- Where a "What the charity register records" section is present, those figures are VERIFIED — filed by the applicant with their regulator, not written for this application. Weigh them accordingly, and weigh the ask against the organisation's scale: an amount that would multiply a charity's annual income is a delivery risk however good the plan, and should be said plainly in the rationale. Note the accounting period given: those figures are routinely 12-18 months old, so describe them as the latest FILED position, never as the organisation's position today.
- The register's **description of activities is not evidence about this proposal**, and is the one part of that section written by the charity itself. It is filed for a regulator, updated rarely, and very often boilerplate copied from the governing document ("to advance education for the public benefit"). Two errors follow, and both are easy to make: do NOT read broad charitable-objects language as alignment with this funder's mission — it is drafted to be broad, and would superficially fit almost any funder — and do NOT treat a vague, thin or dated entry as a mark against the applicant or their track record. Where it conflicts with the applicant's own account of themselves, the application is the current statement and the register is the older one; say so rather than assuming either is wrong.
- Anything labelled as stated by the applicant is unverified. Do not treat it as established fact, and do not treat the absence of a register section as a mark against the applicant — many legitimate organisations are unregistered, newly registered, or have not yet filed.
- A deprivation decile is a measured fact about the AREA, not about the applicant: decile 1 is the most deprived tenth of areas in that nation, decile 10 the least. It is evidence for community need where the programme's goal is about reaching deprived communities, and largely irrelevant where it is not — do not import a geographic priority the funder has not stated.
- **Where no deprivation measure is given, say nothing about deprivation.** Its absence means the lookup did not run or could not match the words the applicant wrote. It is NOT evidence that an area is affluent or that need is unproven, and must never lower community need.
- Where a proposed impact figure is given, read it against the amount requested when judging whether the ask is proportionate. State the comparison in words if it is telling; do not calculate and quote a cost-per-unit figure.

Return your assessment in the exact structured format requested.`
}

/**
 * The nation as it is written in prose. Deliberately NOT `NATION_LABELS` from
 * `lib/deprivation/types`, which is partial by design — it names only Scotland and NI,
 * because England's regions and "Wales" already name themselves in the grouping it
 * serves. Here every nation has to render, so the map is complete.
 */
const NATION_IN_PROSE: Record<DeprivationNation, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
}

/**
 * How the deprivation lookup's verdict reads in the prompt, or null to say nothing.
 *
 * The four outcomes are rendered differently on purpose. `resolved` is a measured fact
 * and states its nation and index vintage, because a decile is only meaningful within
 * one nation's index. `too_broad` and `unresolvable` are verdicts on the applicant's
 * text, so they are stated as such — the model is told the measure is unavailable and
 * why, which is different from being told nothing. `pending` and null return null and
 * the section vanishes: the system prompt's rule is that silence about deprivation must
 * never be read as evidence, and the surest way to keep that rule is to write nothing at
 * all rather than a sentence the model might weigh.
 */
function deprivationLine(result: DeprivationResult | null | undefined): string | null {
  if (!result || result.status === 'pending') return null
  if (result.status === 'unresolvable') {
    return `Deprivation measure: unavailable — "${result.input}" could not be matched to a place, so no decile has been measured. This says nothing about the area itself.`
  }
  if (result.status === 'too_broad') {
    return `Deprivation measure: unavailable — the area given (${result.matchedName}) is too wide to carry a single deprivation measure. This says nothing about the area itself.`
  }
  const scale =
    `1 = most deprived tenth of areas in ${NATION_IN_PROSE[result.nation]}, ` +
    `10 = least; ${result.vintage}`
  // A postcode collapses to one small area, so a range and a median would be three
  // ways of printing the same number.
  if (result.count === 1) {
    return `Deprivation measure: decile ${result.median} of 10 for ${result.areaName} (${scale})`
  }
  return `Deprivation measure: deciles ${result.min}-${result.max} across the ${result.count} small areas of ${result.areaName}, median ${result.median} (${scale})`
}

/**
 * The register's record of the applicant, as its own section.
 *
 * Its own heading and an explicit provenance line, rather than more entries in the
 * field list, because the whole value of these figures is that the applicant did not
 * write them for this application — a reader (and the model) has to be able to tell them
 * apart from the applicant's claims at a glance. Every line is omitted when null: the
 * register answers unevenly, and an empty label reads as a nil return.
 */
function registerSection(profile: OrganisationProfile | null | undefined): string {
  if (!profile) return ''
  const money = (n: number | null) => (n != null ? formatPounds(n) : null)
  const period = profile.financialPeriodEnd
    ? ` (accounting period ending ${profile.financialPeriodEnd})`
    : ''
  const lines = [
    ['Charity type', profile.charityType],
    ['Registered since', profile.registeredSince],
    [`Total income, latest filed accounts${period}`, money(profile.latestIncome)],
    ['Total expenditure, same period', money(profile.latestExpenditure)],
    ['Employees', profile.employees?.toLocaleString('en-GB')],
    ['Volunteers', profile.volunteers?.toLocaleString('en-GB')],
    ['Trustees', profile.trusteeCount?.toLocaleString('en-GB')],
  ]
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([label, v]) => `${label}: ${v}`)
  // Dated to the same annual return as the figures, and hedged twice — see the rules in
  // the system prompt. This text is the charity's OWN prose, so it does not get the
  // "nobody wrote this to win the grant" framing the filed data above it earns.
  const filed = profile.financialPeriodEnd
    ? ` (filed for the period ending ${profile.financialPeriodEnd})`
    : ''
  const activities = profile.activities?.trim()
    ? `\n\n### The charity's own description of its activities, from its annual return${filed}\n` +
      `Written by the charity for its REGULATOR, not for this application, and often years old: ` +
      `many entries are boilerplate lifted from the governing document. Treat it as background on ` +
      `who the applicant is. It is not evidence about this proposal, and its vagueness is not a ` +
      `weakness of the application.\n${profile.activities.trim()}`
    : ''
  if (!lines.length && !activities) return ''
  return (
    `\n\n## What the charity register records\n` +
    `Read from the public register, not from this application. The figures below were FILED with the ` +
    `regulator rather than written to win this grant, and are typically 12-18 months old — the latest ` +
    `filed position, not the position today.\n${lines.join('\n')}${activities}`
  )
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
  const unit = impactUnitLabel(input.impactUnit, input.impactUnitLabel)
  const fields = [
    ['Project delivery area', input.deliveryArea],
    // Stated as a whole line, not a `label: value` pair — the lookup's verdict needs a
    // sentence when it has no measure to give.
    [null, deprivationLine(input.deprivation)],
    [
      `Impact the applicant proposes to achieve, in this programme's unit`,
      input.proposedImpactQuantity != null
        ? `${input.proposedImpactQuantity.toLocaleString('en-GB')} ${unit.charAt(0).toLowerCase()}${unit.slice(1)}`
        : null,
    ],
    ['Registered charity number', input.charityNumber],
    ['Companies House number', input.companyNumber],
    // Named as the applicant's own figure. No register publishes reserves, so unlike
    // the two numbers above it: nothing has checked it, and the label must not let the
    // model read it as verified.
    [
      'Unrestricted reserves (as stated by the applicant)',
      input.unrestrictedReserves != null ? formatPounds(input.unrestrictedReserves) : null,
    ],
  ]
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([label, v]) => (label ? `${label}: ${(v as string).trim()}` : (v as string).trim()))
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

  // The applicant's account of who they are, where a form asked for one. Its own
  // section rather than another entry in `responses`, because that is what it now is
  // on the application — and because it is the paragraph the rest of the submission
  // is read against, so it belongs above the answers, not somewhere in the middle of
  // them where the form happened to ask it.
  const about = input.organisationSummary?.trim()
    ? `\n\n## About the organisation (in the applicant's own words)\n${input.organisationSummary.trim()}`
    : ''

  // Immediately after the applicant's own account of themselves, so the two are read
  // against each other — which is the whole point of holding both.
  const register = registerSection(input.organisationProfile)

  return `# Funder mission
${mission}

# Programme: ${input.programmeName}
Goal: ${goal}${description ? `\nDescription: ${description}` : ''}${
    input.grantDurationYears
      ? `\nGrants from this programme typically run for ${input.grantDurationYears} year${
          input.grantDurationYears === 1 ? '' : 's'
        }.`
      : ''
  }

# Application
Organisation: ${input.organisationName}
Amount requested: £${input.amountRequested.toLocaleString('en-GB')}${fields ? `\n${fields}` : ''}${about}${register}${budget}

## Application responses
${responses || '(no responses provided)'}`
}
