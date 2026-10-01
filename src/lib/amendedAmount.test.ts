import { describe, it, expect } from 'vitest'
import { amendmentDelta, planAmendment } from './amendedAmount'
import { effectiveAmount, isAmended } from './amountRequested'

const base = {
  requested: 50_000,
  currentAmended: null,
  currentFirstYear: null,
  grantDurationYears: 1,
}

describe('effectiveAmount', () => {
  it('is the proposal where there is one, else the ask', () => {
    expect(effectiveAmount({ amountRequested: '50000', amountAmended: '35000' })).toBe(35_000)
    expect(effectiveAmount({ amountRequested: '50000', amountAmended: null })).toBe(50_000)
  })
  it('is null with no ask, whatever is proposed', () => {
    expect(effectiveAmount({ amountRequested: null, amountAmended: '35000' })).toBeNull()
  })
  it('does not call a proposal equal to the ask amended', () => {
    expect(isAmended({ amountRequested: '50000', amountAmended: '50000' })).toBe(false)
    expect(isAmended({ amountRequested: '50000', amountAmended: '35000' })).toBe(true)
    expect(isAmended({ amountRequested: '50000', amountAmended: null })).toBe(false)
  })
})

describe('planAmendment', () => {
  it('lowers the amount', () => {
    const plan = planAmendment({ ...base, amount: 35_000 })
    expect(plan).toMatchObject({ amended: 35_000, effective: 35_000, amountChanged: true })
  })

  it('allows more than was asked for', () => {
    expect(planAmendment({ ...base, amount: 60_000 })).toMatchObject({
      amended: 60_000,
      effective: 60_000,
    })
  })

  it('stores the ask typed back in as no proposal at all', () => {
    const plan = planAmendment({ ...base, currentAmended: 35_000, amount: 50_000 })
    expect(plan).toMatchObject({ amended: null, effective: 50_000, amountChanged: true })
  })

  it('resets to the amount requested', () => {
    expect(planAmendment({ ...base, currentAmended: 35_000, amount: null })).toMatchObject({
      amended: null,
      amountChanged: true,
    })
  })

  it('refuses nothing and less than nothing: that is a decline', () => {
    expect(planAmendment({ ...base, amount: 0 })).toHaveProperty('refused')
    expect(planAmendment({ ...base, amount: -5 })).toHaveProperty('refused')
  })

  it('resets a stated first-year share the new amount no longer holds', () => {
    const plan = planAmendment({
      ...base,
      grantDurationYears: 2,
      currentFirstYear: 30_000,
      amount: 20_000,
    })
    expect(plan).toMatchObject({ firstYear: null, drawdownAfter: 10_000 })
  })

  it('keeps a stated share that still fits, even when the amount goes up', () => {
    const plan = planAmendment({
      ...base,
      grantDurationYears: 2,
      currentFirstYear: 22_000,
      amount: 60_000,
    })
    expect(plan).toMatchObject({ firstYear: 22_000, drawdownBefore: 22_000, drawdownAfter: 22_000 })
  })

  it('takes a share stated in the same breath, and refuses one bigger than the grant', () => {
    expect(
      planAmendment({ ...base, grantDurationYears: 3, amount: 30_000, firstYearAmount: 20_000 }),
    ).toMatchObject({ firstYear: 20_000, drawdownAfter: 20_000 })
    expect(planAmendment({ ...base, amount: 30_000, firstYearAmount: 40_000 })).toHaveProperty(
      'refused',
    )
  })

  it('stores a share typed back to the suggestion as the suggestion', () => {
    expect(
      planAmendment({ ...base, grantDurationYears: 2, amount: 40_000, firstYearAmount: 20_000 }),
    ).toMatchObject({ firstYear: null, drawdownAfter: 20_000 })
  })

  it('reports the draw before and after, which is what the budget ceiling compares', () => {
    const plan = planAmendment({ ...base, currentAmended: 40_000, amount: 45_000 })
    expect(plan).toMatchObject({ drawdownBefore: 40_000, drawdownAfter: 45_000 })
  })

  it('does not call a change to this year alone a new amount', () => {
    const plan = planAmendment({
      ...base,
      grantDurationYears: 2,
      currentAmended: 40_000,
      amount: 40_000,
      firstYearAmount: 30_000,
    })
    expect(plan).toMatchObject({ amountChanged: false, firstYear: 30_000 })
  })
})

describe('amendmentDelta', () => {
  it('signs both directions', () => {
    expect(amendmentDelta(35_000, 50_000)).toBe('−£15,000 (−30%)')
    expect(amendmentDelta(40_000, 30_000)).toBe('+£10,000 (+33%)')
  })
})
