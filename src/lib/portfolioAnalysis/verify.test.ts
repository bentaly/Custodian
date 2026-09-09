import { describe, expect, it } from 'vitest'
import { verifySummary } from './verify'

const brief = {
  portfolio: { committed: { value: 376000, display: '£376,000' }, grants: { value: 9 } },
  deprivation: { shareOfMoneyInDeciles1to4: { value: 75, display: '75%' } },
  byRound: [
    { name: 'Spring 2025', openedAt: '2025-06-04', meanGrant: { value: 49500 } },
    { name: 'Winter 2025', openedAt: '2026-03-01', meanGrant: { value: 29750 } },
  ],
}

describe('verifySummary', () => {
  it('passes a summary whose every figure is in the brief', () => {
    const ok = verifySummary(
      '9 grants worth £376,000, with 75% in deciles 1–4.',
      ['portfolio.grants', 'portfolio.committed'],
      brief,
    )
    expect(ok).toBeNull()
  })

  it('rejects an invented figure — the failure this whole check exists for', () => {
    const failure = verifySummary('Committed funding reached £1,200,000.', [], brief)
    expect(failure?.unsupportedFigures).toEqual(['1200000'])
  })

  it('rejects a figure the model DERIVED rather than quoted', () => {
    // £49,500 - £29,750. Both ends are in the brief; the difference is not, and a
    // subtraction the model did itself is exactly what it may not print.
    const failure = verifySummary('Mean grant fell by £19,750 across the year.', [], brief)
    expect(failure?.unsupportedFigures).toEqual(['19750'])
  })

  it("allows numerals that name a band, because those come from the brief's keys", () => {
    expect(verifySummary('75% sits in deciles 1 to 4.', [], brief)).toBeNull()
  })

  it('allows small integers used as ordinary English rather than as claims', () => {
    expect(verifySummary('Both of the 2 largest programmes are new.', [], brief)).toBeNull()
  })

  it('ignores formatting when comparing — £376,000 and 376000 are the same figure', () => {
    expect(verifySummary('Committed: 376000.', [], brief)).toBeNull()
  })

  it('reports cited paths that do not resolve, without failing on them alone', () => {
    const failure = verifySummary('9 grants.', ['portfolio.nonsense'], brief)
    // The prose is clean, so the summary stands — an unknown path is a signal for
    // tuning the prompt, not grounds for discarding a paragraph whose figures check out.
    expect(failure).toBeNull()
  })

  it('resolves indexed paths into arrays', () => {
    const failure = verifySummary('£1,200,000.', ['byRound[1].meanGrant'], brief)
    expect(failure?.unknownPaths).toEqual([])
  })
})
