import { describe, it, expect, vi } from 'vitest'
import { runCustodianScore, type CustodianScoreAssessor } from './run'
import {
  computeComposite,
  CRITERION_ORDER,
  type CustodianScoreInput,
} from '../../lib/custodianScore'

const INPUT: CustodianScoreInput = {
  missionStatement: 'Improve environmental education for young people in Yorkshire.',
  programmeName: 'Environment & Nature',
  programmeGoal: 'Fund schools-based ecology and nature programmes.',
  programmeDescription: null,
  organisationName: 'Nature Learning Network',
  organisationSummary: null,
  amountRequested: 35000,
  unrestrictedReserves: null,
  budgetBreakdown: null,
  budgetBreakdownLink: null,
  deliveryArea: 'Yorkshire',
  charityNumber: '1234567',
  companyNumber: null,
  responses: [{ label: 'What will you do?', value: 'Run outdoor ecology sessions in 12 schools.' }],
}

/** A stub that returns the same 1–10 score for every criterion. */
function flatAssessor(
  score: number,
  summary = 'ok',
  flags: string[] = [],
  grantPurpose = 'Nature Learning Network will run outdoor ecology sessions in 12 schools.',
): CustodianScoreAssessor {
  return async () => ({
    criteria: Object.fromEntries(
      CRITERION_ORDER.map((k) => [k, { score, rationale: `${k} rationale` }]),
    ) as any,
    grantPurpose,
    summary,
    flags,
  })
}

describe('runCustodianScore', () => {
  it('rolls sub-scores up into a composite and returns scored', async () => {
    const result = await runCustodianScore(INPUT, {
      assess: flatAssessor(8, 'Strong fit.', ['check budget']),
    })
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
      assess: async () => ({ criteria: {} as any, grantPurpose: 'x', summary: '', flags: [] }),
    })
    expect(result.status).toBe('error')
  })

  // The purpose is not part of the assessment: it sits outside `detail` because it has
  // its own column, is a statement of fact rather than a judgement, and is the one
  // thing here that ends up in a letter to a grantee.
  describe('grant purpose', () => {
    it('returns it alongside the score, not inside the detail blob', async () => {
      const result = await runCustodianScore(INPUT, { assess: flatAssessor(8) })
      expect(result.grantPurpose).toBe(
        'Nature Learning Network will run outdoor ecology sessions in 12 schools.',
      )
      expect(result.detail).not.toHaveProperty('grantPurpose')
    })

    it('is null when scoring fails, so a failed re-run cannot blank a stored purpose', async () => {
      const result = await runCustodianScore(INPUT, {
        assess: async () => {
          throw new Error('API down')
        },
      })
      expect(result.grantPurpose).toBeNull()
    })

    it('is null when scoring is not configured', async () => {
      // Stubbed rather than assumed: with a key present this would reach the network.
      vi.stubEnv('ANTHROPIC_API_KEY', '')
      const result = await runCustodianScore(INPUT)
      vi.unstubAllEnvs()
      expect(result.status).toBe('pending')
      expect(result.grantPurpose).toBeNull()
    })

    // A whitespace-only string would satisfy the schema, pass a truthy check on the
    // way into the column, and then render an empty panel and an empty letter block.
    it('treats a blank string as no purpose at all', async () => {
      const result = await runCustodianScore(INPUT, {
        assess: flatAssessor(8, 'ok', [], '   '),
      })
      expect(result.status).toBe('scored')
      expect(result.grantPurpose).toBeNull()
    })
  })
})
