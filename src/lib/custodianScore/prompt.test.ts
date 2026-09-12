import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
import type { CustodianScoreInput } from './types'

const base: CustodianScoreInput = {
  missionStatement: 'Tackling youth disadvantage in the north of England.',
  programmeName: 'Youth Futures',
  programmeGoal: 'Improve employment outcomes for 16–24 year olds.',
  programmeDescription: null,
  programmeThemes: null,
  organisationName: 'Bradford Youth Trust',
  organisationSummary: null,
  amountRequested: 25000,
  unrestrictedReserves: null,
  budgetBreakdown: null,
  budgetBreakdownLink: null,
  deliveryArea: 'Bradford',
  deprivation: null,
  proposedImpactQuantity: null,
  impactUnit: 'people',
  impactUnitLabel: null,
  charityNumber: '1123456',
  companyNumber: null,
  organisationProfile: null,
  grantDurationYears: null,
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

  // The purpose is read beneath the amount and pre-fills the award letter, so it must
  // stay a description of the funded work. Deciles and register figures are assessment
  // context; a purpose citing a charity's filed income would reach a grantee.
  it('keeps the derived assessment context out of it', () => {
    expect(prompt).toMatch(/must never appear in the purpose/i)
    expect(prompt).toMatch(/Deprivation deciles and charity-register figures/i)
  })
})

// The evidence the model is handed is now a mix of verified and claimed, and the two
// carry different weight. Each of these rules exists because its absence has a specific
// failure: reading filed accounts as current, penalising an unregistered applicant, or
// treating a missing decile as an affluent area.
describe('buildSystemPrompt — reading the evidence', () => {
  const prompt = buildSystemPrompt()

  it('separates register-verified figures from the applicant own claims', () => {
    expect(prompt).toMatch(/those figures are VERIFIED/i)
    expect(prompt).toMatch(/labelled as stated by the applicant is unverified/i)
  })

  it('asks for the ask to be weighed against the organisation scale', () => {
    expect(prompt).toMatch(/multiply a charity's annual income/i)
  })

  it('says the filed figures are not the position today', () => {
    expect(prompt).toMatch(/never as the organisation's position today/i)
  })

  it('does not let an unscreened applicant be marked down for it', () => {
    expect(prompt).toMatch(/absence of a register section as a mark against the applicant/i)
  })

  // `strategic_alignment` carries the heaviest weight in the composite, and charitable
  // objects are DRAFTED to be broad — so boilerplate that superficially matches any
  // funder's mission is the one register artefact that could inflate a score rather
  // than depress it.
  it('forbids reading broad charitable objects as alignment with this funder', () => {
    expect(prompt).toMatch(/do NOT read broad charitable-objects language as alignment/i)
    expect(prompt).toMatch(/would superficially fit almost any funder/i)
  })

  it('does not let a thin or dated register entry hurt the applicant', () => {
    expect(prompt).toMatch(/vague, thin or dated entry as a mark against the applicant/i)
  })

  it('treats the application as the current statement where the two conflict', () => {
    expect(prompt).toMatch(
      /the application is the current statement and the register is the older/i,
    )
  })

  it('states the decile scale and that it describes the area, not the applicant', () => {
    expect(prompt).toMatch(/decile 1 is the most deprived tenth/i)
    expect(prompt).toMatch(/measured fact about the AREA/i)
  })

  // The rule that pairs with the renderer's silence: absent evidence must not become
  // evidence of the opposite.
  it('forbids reading a missing decile as an affluent area', () => {
    expect(prompt).toMatch(/NOT evidence that an area is affluent/i)
    expect(prompt).toMatch(/must never lower community need/i)
  })

  it('will not import a geographic priority the funder never stated', () => {
    expect(prompt).toMatch(/do not import a geographic priority the funder has not stated/i)
  })

  // Same reasoning as the portfolio summary's brief: a model that derives a rate will
  // quote it, and a cost-per-beneficiary figure the foundation never computed reads as
  // though it had.
  it('asks for the impact to be weighed but not turned into a rate', () => {
    expect(prompt).toMatch(/do not calculate and quote a cost-per-unit figure/i)
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

// The deprivation lookup has four outcomes and only one of them is a measurement. The
// other three must not reach the model as a weak version of "decile 10" — see the rule
// in the system prompt, and `GOOGLE_MAPS_API_KEY` in CLAUDE.md for why `pending` and
// `unresolvable` are different facts rather than degrees of the same one.
describe('buildUserPrompt — deprivation', () => {
  const resolved = {
    status: 'resolved' as const,
    input: 'Bradford',
    histogram: [],
    nation: 'england' as const,
    vintage: 'IoD2025',
    areaType: 'lad' as const,
    areaName: 'Bradford',
    resolvedVia: 'place' as const,
    regionName: 'Yorkshire and The Humber',
    ladCode: 'E08000032',
    ladName: 'Bradford',
  }

  it('states the spread, the area and the nation for a place', () => {
    const prompt = buildUserPrompt({
      ...base,
      deprivation: { ...resolved, count: 32, min: 1, max: 7, median: 2 },
    })
    expect(prompt).toContain('deciles 1-7 across the 32 small areas of Bradford, median 2')
    // A decile is only meaningful within one nation's index, so both are named.
    expect(prompt).toContain('most deprived tenth of areas in England')
    expect(prompt).toContain('IoD2025')
  })

  it('states a single decile for a postcode, not a range', () => {
    // A postcode collapses to one small area, where min/max/median are the same number
    // and "deciles 3-3, median 3" reads as a bug.
    const prompt = buildUserPrompt({
      ...base,
      deprivation: {
        ...resolved,
        input: 'BD1 1AA',
        areaType: 'lsoa',
        resolvedVia: 'postcode',
        count: 1,
        min: 3,
        max: 3,
        median: 3,
      },
    })
    expect(prompt).toContain('decile 3 of 10 for Bradford')
    expect(prompt).not.toContain('deciles 3-3')
  })

  it('says the measure is unavailable — and says nothing about the area — when unresolvable', () => {
    const prompt = buildUserPrompt({
      ...base,
      deprivation: { status: 'unresolvable', input: 'Pottres Bar' },
    })
    expect(prompt).toContain('unavailable')
    expect(prompt).toContain('Pottres Bar')
    expect(prompt).toContain('says nothing about the area itself')
  })

  it('names the matched place when it was too broad to measure', () => {
    const prompt = buildUserPrompt({
      ...base,
      deprivation: {
        status: 'too_broad',
        input: 'the North',
        matchedName: 'Northern England',
        extentKm: 300,
      },
    })
    expect(prompt).toContain('Northern England')
    expect(prompt).toContain('too wide')
  })

  // The strongest of the four rules: `pending` means the lookup has not run (no API key,
  // or a Google refusal). Writing anything at all invites the model to weigh it, so the
  // section vanishes — silence is the only rendering that cannot be misread as a verdict.
  it('writes nothing at all when the lookup has not run', () => {
    for (const deprivation of [null, undefined, { status: 'pending' as const }]) {
      const prompt = buildUserPrompt({ ...base, deprivation })
      expect(prompt).not.toContain('Deprivation measure')
      expect(prompt).not.toContain('decile')
    }
  })
})

describe('buildUserPrompt — the charity register', () => {
  const profile = {
    source: 'charity_commission' as const,
    activities: 'We run employability and mentoring programmes for disadvantaged young people.',
    latestIncome: 82000,
    latestExpenditure: 79500,
    financialPeriodEnd: '2025-03-31',
    employees: 3,
    volunteers: 24,
    trusteeCount: 7,
    registeredSince: '2011-06-14',
    charityType: 'CIO',
    // The register publishes no reserves field — see the note on the type. The prompt
    // takes reserves from the applicant's own figure instead, labelled as such.
    unrestrictedReserves: null,
    organisationNumber: 4102938,
    fetchedAt: '2026-09-10T09:00:00.000Z',
  }

  it('gives the register its own section, marked as not written by the applicant', () => {
    const prompt = buildUserPrompt({ ...base, organisationProfile: profile })
    expect(prompt).toContain('## What the charity register records')
    expect(prompt).toContain('not from this application')
    // The credibility this section carries belongs to the FILED data specifically, not
    // to the whole of it — the activities prose below is the charity's own writing.
    expect(prompt).toContain('The figures below were FILED with the regulator')
    expect(prompt).toContain('Total income, latest filed accounts')
    expect(prompt).toContain('£82,000')
    expect(prompt).toContain('Volunteers: 24')
  })

  // These figures are routinely 12-18 months old. Unqualified, the model describes them
  // as what the charity has now, which is a statement a grants officer would correct.
  it('dates the financial figures and says they are not the position today', () => {
    const prompt = buildUserPrompt({ ...base, organisationProfile: profile })
    expect(prompt).toContain('accounting period ending 2025-03-31')
    expect(prompt).toContain('the latest filed position, not the position today')
  })

  it("carries the charity's own account of its activities", () => {
    const prompt = buildUserPrompt({ ...base, organisationProfile: profile })
    expect(prompt).toContain('employability and mentoring programmes')
  })

  // The activities prose is the one part of this section the charity DID write, so it
  // must not inherit the "nobody wrote this to win the grant" framing the filed figures
  // earn — and it comes off the same annual return, so it is no fresher than they are.
  describe('the activities prose', () => {
    const prompt = buildUserPrompt({ ...base, organisationProfile: profile })

    it('is dated to the annual return it was filed with', () => {
      expect(prompt).toContain('filed for the period ending 2025-03-31')
    })

    it('is attributed to the charity, writing for its regulator', () => {
      expect(prompt).toMatch(/Written by the charity for its REGULATOR, not for this application/i)
    })

    it('warns that it is often boilerplate, and is not evidence about the proposal', () => {
      expect(prompt).toMatch(/boilerplate lifted from the governing document/i)
      expect(prompt).toContain('not evidence about this proposal')
    })

    // Both directions of the error, because vagueness here cuts both ways.
    it('does not let its vagueness count against the applicant', () => {
      expect(prompt).toContain('vagueness is not a weakness of the application')
    })

    it('does not claim the applicant wrote none of the section', () => {
      // The original framing said exactly this, and it was false of the prose below it.
      expect(prompt).not.toContain('the applicant did not write any of it')
    })
  })

  // The register answers unevenly — a newly registered charity has no filed accounts.
  // An empty label would read as a nil return, which is a different fact from silence.
  it('omits the lines the register did not answer', () => {
    const prompt = buildUserPrompt({
      ...base,
      organisationProfile: { ...profile, latestIncome: null, volunteers: null, activities: null },
    })
    expect(prompt).toContain('## What the charity register records')
    expect(prompt).not.toContain('Total income')
    expect(prompt).not.toContain('Volunteers')
    expect(prompt).not.toContain('annual return')
  })

  it('drops the section when the register answered nothing at all', () => {
    const prompt = buildUserPrompt({
      ...base,
      organisationProfile: {
        source: 'charity_commission',
        activities: null,
        latestIncome: null,
        latestExpenditure: null,
        financialPeriodEnd: null,
        employees: null,
        volunteers: null,
        trusteeCount: null,
        registeredSince: null,
        charityType: null,
        unrestrictedReserves: null,
        organisationNumber: null,
        fetchedAt: '2026-09-10T09:00:00.000Z',
      },
    })
    expect(prompt).not.toContain('## What the charity register records')
  })

  it('says nothing when the applicant was never screened', () => {
    expect(buildUserPrompt(base)).not.toContain('charity register')
  })
})

describe('buildUserPrompt — proposed impact and duration', () => {
  // `budget_quality` is defined as whether the ask is proportionate to "the outcomes
  // sought", and until this was passed the outcomes sought were not in the prompt.
  it('states the proposed impact in the programme own unit', () => {
    const prompt = buildUserPrompt({ ...base, proposedImpactQuantity: 90 })
    expect(prompt).toContain('90 people')
  })

  it("uses a foundation's own phrase for a custom unit", () => {
    const prompt = buildUserPrompt({
      ...base,
      proposedImpactQuantity: 12,
      impactUnit: 'other',
      impactUnitLabel: 'hectares of peatland restored',
    })
    expect(prompt).toContain('12 hectares of peatland restored')
  })

  it('says nothing about impact when the foundation does not collect it', () => {
    expect(buildUserPrompt(base)).not.toContain('Impact the applicant proposes')
  })

  it('states the grant duration with the programme, pluralised', () => {
    expect(buildUserPrompt({ ...base, grantDurationYears: 3 })).toContain(
      'typically run for 3 years',
    )
    expect(buildUserPrompt({ ...base, grantDurationYears: 1 })).toContain('run for 1 year.')
  })

  // The round-programme budget and max grant are deliberately never passed: affordability
  // is none of the six criteria and is the foundation's decision, not the assessor's.
  it('never states a programme budget', () => {
    const prompt = buildUserPrompt({ ...base, grantDurationYears: 3 })
    expect(prompt).not.toContain('budget for this programme')
    expect(prompt).not.toContain('Maximum grant')
  })
})
