import { describe, expect, it } from 'vitest'
import { SaveRoundSchema } from './round'

const base = {
  name: 'Spring 2026',
  openedAt: '2026-02-01',
  closedAt: '2026-03-31',
  programmes: [],
}

const programme = (programmeId: string, budget = 1000) => ({
  programmeId,
  budget,
  maxGrantAmount: null,
  grantDurationYears: null,
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('SaveRoundSchema', () => {
  it('accepts a round with no programmes yet', () => {
    expect(SaveRoundSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a round that opens and closes on the same day', () => {
    const result = SaveRoundSchema.safeParse({ ...base, closedAt: base.openedAt })
    expect(result.success).toBe(true)
  })

  it('rejects a round that closes before it opens', () => {
    const result = SaveRoundSchema.safeParse({ ...base, closedAt: '2026-01-01' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['closedAt'])
  })

  it('rejects the same programme funded twice in one round', () => {
    // `round_programmes_uniq` would reject this at the database, but the dialog can
    // only say WHICH field is wrong if the schema catches it first.
    const result = SaveRoundSchema.safeParse({
      ...base,
      programmes: [programme(A), programme(A, 2000)],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['programmes'])
  })

  it('allows two different programmes', () => {
    const result = SaveRoundSchema.safeParse({
      ...base,
      programmes: [programme(A), programme(B)],
    })
    expect(result.success).toBe(true)
  })

  it('allows a £0 budget but not a negative one', () => {
    // £0 is how a programme stops being funded without being removed — which is the
    // only way out for a programme that already has applications in the round.
    expect(SaveRoundSchema.safeParse({ ...base, programmes: [programme(A, 0)] }).success).toBe(true)
    expect(SaveRoundSchema.safeParse({ ...base, programmes: [programme(A, -1)] }).success).toBe(
      false,
    )
  })

  it('treats a blank name as missing', () => {
    expect(SaveRoundSchema.safeParse({ ...base, name: '' }).success).toBe(false)
  })

  it('requires both dates', () => {
    expect(SaveRoundSchema.safeParse({ ...base, openedAt: '' }).success).toBe(false)
    expect(SaveRoundSchema.safeParse({ ...base, closedAt: '' }).success).toBe(false)
  })

  it('rejects a zero or fractional grant duration', () => {
    const withDuration = (grantDurationYears: number) => ({
      ...base,
      programmes: [{ ...programme(A), grantDurationYears }],
    })
    expect(SaveRoundSchema.safeParse(withDuration(0)).success).toBe(false)
    expect(SaveRoundSchema.safeParse(withDuration(2.5)).success).toBe(false)
    expect(SaveRoundSchema.safeParse(withDuration(3)).success).toBe(true)
  })
})
