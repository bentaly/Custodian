import { describe, it, expect } from 'vitest'
import { runCustodianScore, type CustodianScoreAssessor } from './run'
import { computeComposite, CRITERION_ORDER, type CustodianScoreInput } from '../../lib/custodianScore'

const INPUT: CustodianScoreInput = {
  missionStatement: 'Improve environmental education for young people in Yorkshire.',
  programmeName: 'Environment & Nature',
  programmeGoal: 'Fund schools-based ecology and nature programmes.',
  programmeDescription: null,
  organisationName: 'Nature Learning Network',
  amountRequested: 35000,
  responses: [{ label: 'What will you do?', value: 'Run outdoor ecology sessions in 12 schools.' }],
}

/** A stub that returns the same 1–10 score for every criterion. */
function flatAssessor(score: number, summary = 'ok', flags: string[] = []): CustodianScoreAssessor {
  return async () => ({
    criteria: Object.fromEntries(
      CRITERION_ORDER.map((k) => [k, { score, rationale: `${k} rationale` }]),
    ) as any,
    summary,
    flags,
  })
}

describe('runCustodianScore', () => {
  it('rolls sub-scores up into a composite and returns scored', async () => {
    const result = await runCustodianScore(INPUT, { assess: flatAssessor(8, 'Strong fit.', ['check budget']) })
    expect(result.status).toBe('scored')
    expect(result.score).toBe(80) // all-8s → 8/10 → 80/100
    expect(result.detail?.summary).toBe('Strong fit.')
    expect(result.detail?.flags).toEqual(['check budget'])
    expect(result.detail?.criteria.strategic_alignment.score).toBe(8)
  })

  it('weights strategic_alignment more heavily than additionality', async () => {
    // High alignment, low additionality should beat the reverse.
    const high = computeComposite({
      ...Object.fromEntries(CRITERION_ORDER.map((k) => [k, { score: 5 }])),
      strategic_alignment: { score: 10 },
      additionality: { score: 1 },
    } as any)
    const low = computeComposite({
      ...Object.fromEntries(CRITERION_ORDER.map((k) => [k, { score: 5 }])),
      strategic_alignment: { score: 1 },
      additionality: { score: 10 },
    } as any)
    expect(high).toBeGreaterThan(low)
  })

  it('returns error status (never throws) when the model call fails', async () => {
    const result = await runCustodianScore(INPUT, {
      assess: async () => {
        throw new Error('API down')
      },
    })
    expect(result.status).toBe('error')
    expect(result.score).toBeNull()
    expect(result.detail?.error).toBe('API down')
  })

  it('flags a missing criterion as an error rather than producing a bad composite', async () => {
    const result = await runCustodianScore(INPUT, {
      assess: async () => ({ criteria: {} as any, summary: '', flags: [] }),
    })
    expect(result.status).toBe('error')
  })
})
