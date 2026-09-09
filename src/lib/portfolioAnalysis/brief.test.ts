import { describe, expect, it } from 'vitest'
import { buildPortfolioBrief, type BriefStrategy } from './brief'
import type { InsightsGrant } from '../../server/fns/insights'

// A grant, with only the fields the brief actually reads spelled out per test.
function grant(over: Partial<InsightsGrant> = {}): InsightsGrant {
  return {
    awardId: 'a1',
    applicationId: 'app1',
    organisationName: 'Org',
    programmeId: 'p1',
    programmeName: 'Youth Futures',
    programmeColour: null,
    unitKey: 'people',
    unitLabel: 'People',
    tags: [],
    roundId: 'r1',
    roundName: 'Spring 2025',
    roundOpenedAt: '2025-01-01T00:00:00.000Z',
    decisionAt: '2025-02-01T00:00:00.000Z',
    status: 'active',
    amountAwarded: 10000,
    region: 'North West',
    ladCode: null,
    ladName: null,
    deprivation: null,
    impactQuantity: null,
    proposedImpactQuantity: null,
    impactQuote: null,
    ...over,
  }
}

const strategy: BriefStrategy = {
  missionStatement: 'We fund the places overlooked longest.',
  programmes: [{ name: 'Youth Futures', goal: 'Into work', impactUnit: 'People' }],
}

describe('buildPortfolioBrief', () => {
  it('orders rounds chronologically, not by size — the series IS the direction of travel', () => {
    const brief = buildPortfolioBrief(
      [
        grant({
          roundId: 'r2',
          roundName: 'Autumn',
          roundOpenedAt: '2025-09-01',
          amountAwarded: 5,
        }),
        grant({
          roundId: 'r1',
          roundName: 'Spring',
          roundOpenedAt: '2025-01-01',
          amountAwarded: 90,
        }),
      ],
      strategy,
    )
    expect(brief.byRound.map((r) => r.name)).toEqual(['Spring', 'Autumn'])
  })

  it('never totals impact across units — 5 hectares and 5 people are not 10 of anything', () => {
    const brief = buildPortfolioBrief(
      [
        grant({ unitKey: 'people', unitLabel: 'People', impactQuantity: 5 }),
        grant({ unitKey: 'hectares', unitLabel: 'Hectares', impactQuantity: 5 }),
      ],
      strategy,
    )
    expect(brief.impact.byUnit).toHaveLength(2)
    expect(brief.impact.byUnit.map((u) => u.unit).sort()).toEqual(['Hectares', 'People'])
  })

  it('marks a unit total that contains a proposed figure, so a forecast is never quoted as achieved', () => {
    const brief = buildPortfolioBrief(
      [grant({ impactQuantity: null, proposedImpactQuantity: 40 })],
      strategy,
    )
    expect(brief.impact.byUnit[0]?.includesProposed).toBe(true)
    expect(brief.coverage.join(' ')).toContain('PROPOSED')
  })

  it('carries every theme, including the tail the screen truncates', () => {
    const themes = Array.from({ length: 14 }, (_, i) => `Theme ${i}`)
    const brief = buildPortfolioBrief(
      themes.map((t) => grant({ tags: [t] })),
      strategy,
    )
    expect(brief.byTheme).toHaveLength(14)
  })

  it('states count share and money share side by side — the comparison no panel draws', () => {
    const brief = buildPortfolioBrief(
      [
        grant({ region: 'London', amountAwarded: 90 }),
        grant({ region: 'North East', amountAwarded: 5 }),
        grant({ region: 'North East', amountAwarded: 5 }),
      ],
      strategy,
    )
    const ne = brief.byArea.find((a) => a.region === 'North East')!
    expect(ne.shareOfGrants.display).toBe('67%')
    expect(ne.shareOfCommitted.display).toBe('10%')
  })

  it('gives grants with no delivery area their own row rather than dropping them', () => {
    const brief = buildPortfolioBrief([grant({ region: null })], strategy)
    expect(brief.byArea[0]?.region).toBe('No delivery area recorded')
  })

  it('counts repeat grantees case- and whitespace-insensitively, and no further', () => {
    const brief = buildPortfolioBrief(
      [
        grant({ organisationName: 'Bradford Trust' }),
        grant({ organisationName: '  bradford trust ' }),
        grant({ organisationName: 'Bradford Trust Ltd' }),
      ],
      strategy,
    )
    expect(brief.portfolio.organisationsFunded.value).toBe(2)
    expect(brief.portfolio.organisationsFundedMoreThanOnce.value).toBe(1)
  })

  it("weights deprivation by each grant's decile spread, not by a single decile per grant", () => {
    // Half this grant's LSOAs sit in deciles 1-4, so half its money counts toward them.
    const dep = {
      nation: 'england',
      vintage: '2019',
      min: 1,
      max: 10,
      median: 5,
      histogram: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    }
    const brief = buildPortfolioBrief([grant({ amountAwarded: 1000, deprivation: dep })], strategy)
    expect(brief.deprivation.shareOfMoneyInDeciles1to4.display).toBe('50%')
  })

  it('omits coverage notes for limits that do not exist', () => {
    const brief = buildPortfolioBrief([grant({ impactQuantity: 5, region: 'Wales' })], strategy)
    expect(brief.coverage.join(' ')).not.toContain('no impact figure')
  })

  it('survives an empty portfolio without dividing by zero', () => {
    const brief = buildPortfolioBrief([], strategy)
    expect(brief.portfolio.committed.display).toBe('£0')
    expect(brief.portfolio.meanGrant.display).toBe('£0')
    expect(brief.deprivation.shareOfMoneyInDeciles1to4.display).toBe('0%')
  })
})
