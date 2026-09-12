import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
import {
  assignedThemes,
  CustodianScoreOutputSchema,
  custodianScoreOutputSchemaFor,
  offeredThemes,
} from './schema'
import { CRITERION_ORDER } from './definitions'
import type { CustodianScoreInput } from './types'

const base: CustodianScoreInput = {
  missionStatement: 'Tackling youth disadvantage in the north of England.',
  programmeName: 'Youth Futures',
  programmeGoal: 'Improve employment outcomes for 16–24 year olds.',
  programmeDescription: null,
  programmeThemes: ['Youth', 'Employment', 'Mental health'],
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

const output = (themes?: string[]) => ({
  criteria: Object.fromEntries(CRITERION_ORDER.map((k) => [k, { score: 7, rationale: 'x' }])),
  grantPurpose: 'Bradford Youth Trust will run six courses.',
  summary: 'ok',
  flags: [],
  ...(themes ? { themes } : {}),
})

describe('themes in the prompt', () => {
  it("lists the programme's themes to choose from", () => {
    expect(buildUserPrompt(base)).toContain(
      'Themes to choose from:\n- Youth\n- Employment\n- Mental health',
    )
  })

  it('says nothing about themes when the programme has none', () => {
    expect(buildUserPrompt({ ...base, programmeThemes: [] })).not.toContain('Themes to choose')
    expect(buildUserPrompt({ ...base, programmeThemes: null })).not.toContain('Themes to choose')
  })

  // The system prompt is behind a cache breakpoint: it must stay identical whatever
  // the programme's themes are.
  it('keeps the rules in the system prompt, which does not vary by programme', () => {
    expect(buildSystemPrompt()).toContain("choose this application's themes")
    expect(buildSystemPrompt()).toContain('A theme is a category, not evidence')
  })
})

describe('custodianScoreOutputSchemaFor', () => {
  it("accepts only the programme's own themes", () => {
    const schema = custodianScoreOutputSchemaFor(base.programmeThemes!)
    expect(schema.safeParse(output(['Youth'])).success).toBe(true)
    expect(schema.safeParse(output(['Rewilding'])).success).toBe(false)
  })

  it('is the plain schema when there is nothing to choose from', () => {
    expect(custodianScoreOutputSchemaFor([])).toBe(CustodianScoreOutputSchema)
    expect(custodianScoreOutputSchemaFor(['  '])).toBe(CustodianScoreOutputSchema)
  })
})

describe('offeredThemes / assignedThemes', () => {
  it('trims and de-duplicates what is offered', () => {
    expect(offeredThemes([' Youth', 'youth', '', 'Employment'])).toEqual(['Youth', 'Employment'])
  })

  it("returns the picks in the programme's order and spelling, dropping anything else", () => {
    expect(assignedThemes(['mental health', 'Youth', 'Rewilding'], base.programmeThemes)).toEqual([
      'Youth',
      'Mental health',
    ])
  })
})
