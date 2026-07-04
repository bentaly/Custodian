// ─── Report analysis: prompt builders ────────────────────────────────────────
//
// Pure string builders, split for prompt caching like the Custodian-score
// prompts: the system prompt is identical for every report → cached; the user
// prompt carries the specific report + application + programme → volatile.

export interface ReportAnalysisInput {
  /** The programme's impact unit as a plural noun phrase, e.g. "people",
   *  "hectares of peatland restored". Drives the extraction question. */
  impactUnitLabel: string
  programme: {
    name: string | null
    description: string | null
    goal: string | null
  }
  missionStatement?: string | null
  grant: {
    amountAwarded: number | null
    awardedAt: string | null
  }
  /** The original application, when the grant has one (null for direct grants). */
  application: {
    organisationName: string | null
    amountRequested: number | null
    responses: Array<{ label: string; value: string }>
  } | null
  report: {
    organisationName: string
    impactSummary: string
    grantPurpose?: string | null
    grantTitle?: string | null
    challenges?: string | null
    lessons?: string | null
    caseStudies?: string | null
    testimonials?: string | null
    otherComments?: string | null
    amountAwarded?: number | null
    beneficiaryCount?: number | null
    deliveryArea?: string | null
    responses: Array<{ label: string; value: string }>
  }
}

export function buildSystemPrompt(): string {
  return `You are an assessor for a UK grant-making foundation, reviewing a progress/impact report submitted by a grantee charity.

You will be given: the programme the grant came from (its goal), the grant (amount, award date), the original application where one exists (what the charity promised to do), and the report itself (every field the charity submitted).

Produce six things:

1. **Summary** — a 2-4 sentence digest for the grant officer: what was delivered and the headline impact. Ground it in what the report actually says.

2. **Application alignment** — compare the report against the original application. Did the charity do what they said they would? Score 1-10, list specific promises kept and promises unmet/unevidenced. If no application is provided, return null for this whole section.

3. **Programme alignment** — how well does the reported work advance the programme's goal? Score 1-10.

4. **Challenges summary** — 1-3 sentences on what challenges the grantee faced and whether/how they were overcome. Draw from anywhere in the report, not just a dedicated "challenges" field — these often hide in general narrative or follow-up answers. Null only if the report genuinely mentions none.

5. **Lessons summary** — 1-3 sentences on what the grantee learned from delivering the grant. Same rules: look everywhere, null only if genuinely absent. Funders read these two summaries closely, so be concrete — name the actual challenge and the actual lesson, not "they faced some difficulties".

6. **Impact quantity** — the report's evidence will be measured in a specific unit, stated in the user message (e.g. "people", "hectares of peatland restored"). Find how many of that unit this report evidences as achieved WITH THIS GRANT. Rules:
   - Only count what the report states or clearly supports; quote the exact snippet.
   - Prefer totals attributable to this grant over organisation-wide figures. A rate ("130 people a month attend") is not a total — only convert it when the report states the period it ran; otherwise treat the quantity as not found and mention it in flags.
   - If the report evidences no quantity in that unit, return found=false and value=null. NEVER guess, NEVER return 0 to mean "not found".

Also list any flags a grant officer should check: mismatch between the grant amount and what the report claims was received, work not delivered, unspent funds, safeguarding concerns. Be specific and cite the report.

Scoring guidance: use the full 1-10 range; most solid reports land 5-8. Reserve 9-10 for fully-evidenced delivery of everything promised. A glowing narrative with no evidence scores in the middle, not the top.`
}

function section(title: string, lines: Array<string | null | undefined>): string {
  const body = lines.filter(Boolean).join('\n')
  return body ? `# ${title}\n${body}` : ''
}

function kv(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  return `- ${label}: ${value}`
}

function responsesBlock(responses: Array<{ label: string; value: string }>): string | null {
  if (!responses.length) return null
  return responses.map((r) => `- ${r.label}: ${r.value}`).join('\n')
}

export function buildUserPrompt(input: ReportAnalysisInput): string {
  const parts = [
    `The impact unit for this programme is: **${input.impactUnitLabel}**. Extract the impact quantity in this unit.`,
    section('Programme', [
      kv('Name', input.programme.name),
      kv('Description', input.programme.description),
      kv('Goal', input.programme.goal),
      kv("Funder's mission", input.missionStatement ?? null),
    ]),
    section('Grant', [
      kv('Amount awarded', input.grant.amountAwarded),
      kv('Awarded', input.grant.awardedAt),
    ]),
    input.application
      ? section('Original application (what the charity promised)', [
          kv('Organisation', input.application.organisationName),
          kv('Amount requested', input.application.amountRequested),
          responsesBlock(input.application.responses),
        ])
      : '# Original application\n(none on record — return null for applicationAlignment)',
    section('The report', [
      kv('Organisation', input.report.organisationName),
      kv('Grant title', input.report.grantTitle),
      kv('Grant purpose', input.report.grantPurpose),
      kv('Impact summary', input.report.impactSummary),
      kv('Challenges', input.report.challenges),
      kv('Lessons learned', input.report.lessons),
      kv('Case studies', input.report.caseStudies),
      kv('Testimonials', input.report.testimonials),
      kv('Other comments', input.report.otherComments),
      kv('Amount received (as stated by charity)', input.report.amountAwarded),
      kv('Beneficiary count (as stated by charity)', input.report.beneficiaryCount),
      kv('Delivery area', input.report.deliveryArea),
      responsesBlock(input.report.responses),
    ]),
  ]
  return parts.filter(Boolean).join('\n\n')
}
