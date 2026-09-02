import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
import type { CustodianScoreInput } from './types'

const base: CustodianScoreInput = {
  missionStatement: 'Tackling youth disadvantage in the north of England.',
  programmeName: 'Youth Futures',
  programmeGoal: 'Improve employment outcomes for 16–24 year olds.',
  programmeDescription: null,
  organisationName: 'Bradford Youth Trust',
  organisationSummary: null,
  amountRequested: 25000,
  unrestrictedReserves: null,
  budgetBreakdown: null,
  budgetBreakdownLink: null,
  deliveryArea: 'Bradford',
  charityNumber: '1123456',
  companyNumber: null,
  responses: [{ label: 'What will you do?', value: 'Run six employability courses.' }],
}

describe('buildUserPrompt — budget', () => {
  it('itemises a structured breakdown', () => {
    const prompt = buildUserPrompt({
      ...base,
      budgetBreakdown: [
        { item: 'Staff costs', amount: 18000 },
        { item: 'Venue hire', amount: 4000 },
      ],
    })
    expect(prompt).toContain('## Project budget')
    expect(prompt).toContain('Staff costs')
    expect(prompt).toContain('Total project budget')
  })

  it('says nothing about a budget when the foundation captured none', () => {
    expect(buildUserPrompt(base)).not.toContain('## Project budget')
  })

  // `budget_quality` is scored on "vague, padded, or poorly justified costs". With the
  // budget sitting in a file we can't read, silence makes the model mark an application
  // down for an omission the applicant never made — their form asked for an upload.
  describe('when the budget arrived as a document', () => {
    const prompt = buildUserPrompt({
      ...base,
      budgetBreakdownLink: 'https://api.typeform.com/responses/files/abc/Project_Budget.ods',
    })

    it('tells the model the budget exists but is unavailable', () => {
      expect(prompt).toContain('## Project budget')
      expect(prompt).toMatch(/NOT.*available to you/)
    })

    it('forbids penalising the applicant for it', () => {
      expect(prompt).toMatch(/do not treat the budget as missing, vague or unjustified/i)
    })

    it('equally forbids assuming the document is any good', () => {
      // The opposite failure, and the more dangerous one: told simply to disregard the
      // absence, the model credits a budget it has never seen, and a blank spreadsheet
      // scores like a rigorous one.
      expect(prompt).toMatch(/do not assume the document is thorough/i)
    })

    it('never leaks the URL into the prompt', () => {
      // The link is not evidence — it is a pointer to evidence the model cannot follow.
      // Including it invites the model to reason about a file it has not opened.
      expect(prompt).not.toContain('typeform.com')
    })
  })

  it('prefers the real breakdown when both arrive', () => {
    const prompt = buildUserPrompt({
      ...base,
      budgetBreakdown: [{ item: 'Staff costs', amount: 18000 }],
      budgetBreakdownLink: 'https://example.org/budget.xlsx',
    })
    expect(prompt).toContain('Staff costs')
    expect(prompt).not.toMatch(/not.*available to you/i)
  })
})

// The purpose is the one model output that leaves the building: an admin may accept it
// unedited in award set-up, and it is then quoted in the letter the grantee receives.
// Assessment language there ("a strong, well-evidenced proposal") would read as the
// foundation praising the grantee inside what is effectively a contractual clause.
describe('buildSystemPrompt — grant purpose', () => {
  const prompt = buildSystemPrompt()

  it('asks for it separately from the assessment', () => {
    expect(prompt).toMatch(/state the grant purpose/i)
    expect(prompt).toMatch(/NOT part of your assessment/i)
  })

  it('rules out evaluative language', () => {
    expect(prompt).toMatch(/no evaluation, praise, hedging or scoring words/i)
  })

  it('asks for a complete sentence, since it is rendered as its own block', () => {
    expect(prompt).toMatch(/complete sentence beginning with the organisation/i)
  })

  it('forbids inventing detail the application does not give', () => {
    expect(prompt).toMatch(/rather than (guessing|inventing detail)/i)
  })
})

describe('buildUserPrompt — the organisation', () => {
  // Both of these reached the model as ordinary `responses` entries before they were
  // canonical fields. Promoting a field to a column REMOVES it from `responses`, so
  // without these two lines the change would have quietly deleted the applicant's
  // description of themselves and their reserves from every future score — a silent
  // regression, since a prompt that is missing something still returns a number.
  it('gives the applicant summary its own section', () => {
    const prompt = buildUserPrompt({
      ...base,
      organisationSummary: 'We run a boxing gym for young people excluded from school.',
    })
    expect(prompt).toContain("## About the organisation (in the applicant's own words)")
    expect(prompt).toContain('boxing gym for young people excluded from school')
    // Above the answers it is read against, not somewhere in the middle of them.
    expect(prompt.indexOf('## About the organisation')).toBeLessThan(
      prompt.indexOf('## Application responses'),
    )
  })

  it('omits the section entirely when the form did not ask', () => {
    expect(buildUserPrompt(base)).not.toContain('## About the organisation')
  })

  it("states reserves as the applicant's own figure", () => {
    // No register publishes reserves, so unlike the charity number beside it nothing
    // has checked this. The label has to say so or the model reads it as verified.
    const prompt = buildUserPrompt({ ...base, unrestrictedReserves: 80647 })
    expect(prompt).toContain('Unrestricted reserves (as stated by the applicant): £80,647')
  })

  it('says nothing about reserves when none were captured', () => {
    expect(buildUserPrompt(base)).not.toContain('Unrestricted reserves')
  })
})
