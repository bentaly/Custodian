import { describe, it, expect } from 'vitest'
import { headroom, rollUpBudget, splitOutstanding } from './annualBudget'

const actual = (
  programmeId: string,
  committed: number,
  paid: number,
  name = programmeId,
): {
  programmeId: string
  name: string
  colour: string | null
  committed: number
  paid: number
} => ({ programmeId, name, colour: null, committed, paid })

describe('rollUpBudget', () => {
  it('pairs each budget line with its programme actuals, in the budget order', () => {
    const r = rollUpBudget(
      [
        { programmeId: 'youth', label: null, amount: 366_000 },
        { programmeId: 'warm', label: null, amount: 289_000 },
      ],
      [
        actual('warm', 231_500, 142_750, 'Warm Homes'),
        actual('youth', 318_400, 196_000, 'Youth Futures'),
      ],
    )
    expect(r.lines.map((l) => l.name)).toEqual(['Youth Futures', 'Warm Homes'])
    expect(r.total).toBe(655_000)
    expect(r.committed).toBe(549_900)
    expect(r.paid).toBe(338_750)
    expect(r.remaining).toBe(655_000 - 549_900)
  })

  it('names a core-costs line by its own label and gives it no actuals', () => {
    const r = rollUpBudget([{ programmeId: null, label: 'Core costs', amount: 60_000 }], [])
    expect(r.lines[0]).toMatchObject({
      programmeId: null,
      name: 'Core costs',
      budget: 60_000,
      committed: 0,
      used: 0,
      remaining: 60_000,
    })
  })

  it('falls back to "Core costs" when a non-grant line has no label', () => {
    const r = rollUpBudget([{ programmeId: null, label: null, amount: 1000 }], [])
    expect(r.lines[0]!.name).toBe('Core costs')
  })

  it('allows several non-grant lines — NULL programmes are distinct', () => {
    const r = rollUpBudget(
      [
        { programmeId: null, label: 'Core costs', amount: 40_000 },
        { programmeId: null, label: 'Governance', amount: 12_000 },
      ],
      [],
    )
    expect(r.lines.map((l) => l.name)).toEqual(['Core costs', 'Governance'])
    expect(r.total).toBe(52_000)
  })

  // Rule 1 — see the module header.
  it('uses paid when a cancellation has left it above committed', () => {
    // £30,000 awarded, £10,000 paid, then cancelled: committed drops to 0, paid stays.
    const r = rollUpBudget(
      [{ programmeId: 'p', label: null, amount: 50_000 }],
      [actual('p', 0, 10_000)],
    )
    expect(r.lines[0]!.used).toBe(10_000)
    expect(r.lines[0]!.remaining).toBe(40_000)
    expect(r.remaining).toBe(40_000)
  })

  it('never draws a meter backwards when paid exceeds committed', () => {
    const r = rollUpBudget(
      [{ programmeId: 'p', label: null, amount: 5_000 }],
      [actual('p', 0, 10_000)],
    )
    // Over budget: the line reports it, the headline is floored at zero.
    expect(r.lines[0]!.remaining).toBe(-5_000)
    expect(r.remaining).toBe(0)
  })

  it('uses committed in the ordinary case, where it is the larger', () => {
    const r = rollUpBudget(
      [{ programmeId: 'p', label: null, amount: 100_000 }],
      [actual('p', 80_000, 30_000)],
    )
    expect(r.lines[0]!.used).toBe(80_000)
  })

  // Rule 2 — see the module header.
  it('appends a line for a programme with spend but no allocation', () => {
    const r = rollUpBudget(
      [{ programmeId: 'youth', label: null, amount: 100_000 }],
      [actual('youth', 50_000, 0, 'Youth'), actual('rogue', 24_000, 24_000, 'Unbudgeted')],
    )
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1]).toMatchObject({ name: 'Unbudgeted', budget: 0, remaining: -24_000 })
    // The bars still sum to the money that actually went out.
    expect(r.committed).toBe(74_000)
    expect(r.total).toBe(100_000)
  })

  it('ignores a programme with no allocation and no spend', () => {
    const r = rollUpBudget([], [actual('quiet', 0, 0)])
    expect(r.lines).toHaveLength(0)
  })

  it('returns an all-zero rollup for an empty budget', () => {
    expect(rollUpBudget([], [])).toMatchObject({
      lines: [],
      total: 0,
      committed: 0,
      paid: 0,
      used: 0,
      remaining: 0,
    })
  })

  it('keeps a budgeted programme that has awarded nothing this year', () => {
    const r = rollUpBudget([{ programmeId: 'p', label: null, amount: 20_000 }], [])
    expect(r.lines[0]).toMatchObject({ budget: 20_000, committed: 0, remaining: 20_000 })
  })

  it('names a spend-free budgeted programme from the fallback map', () => {
    const r = rollUpBudget(
      [{ programmeId: 'p', label: null, amount: 20_000 }],
      [],
      new Map([['p', { name: 'Wild Rivers', colour: '#2baf9d' }]]),
    )
    expect(r.lines[0]).toMatchObject({ name: 'Wild Rivers', colour: '#2baf9d' })
  })
})

describe('splitOutstanding', () => {
  it('derives unscheduled so the parts sum to the total', () => {
    const s = splitOutstanding(100_000, { dueByYearEnd: 40_000, dueLater: 25_000, undated: 5_000 })
    expect(s.unscheduled).toBe(30_000)
    expect(s.dueByYearEnd + s.dueLater + s.undated + s.unscheduled).toBe(s.total)
  })

  it('reports no unscheduled money when every penny is on a schedule', () => {
    const s = splitOutstanding(65_000, { dueByYearEnd: 40_000, dueLater: 25_000, undated: 0 })
    expect(s.unscheduled).toBe(0)
  })

  it('clamps rather than reporting negative unscheduled when a schedule overshoots', () => {
    const s = splitOutstanding(50_000, { dueByYearEnd: 60_000, dueLater: 0, undated: 0 })
    expect(s.unscheduled).toBe(0)
  })

  it('floors a negative total at zero', () => {
    expect(splitOutstanding(-10, { dueByYearEnd: 0, dueLater: 0, undated: 0 }).total).toBe(0)
  })
})

describe('headroom', () => {
  it('sets cash against what falls due inside the year, not against everything owed', () => {
    const s = splitOutstanding(400_000, {
      dueByYearEnd: 120_000,
      dueLater: 275_000,
      undated: 5_000,
    })
    // The naive reading would be 742,180 − 400,000 = 342,180 and would look alarming
    // for a foundation whose commitments are simply spread over three years.
    expect(headroom(742_180, s)).toBe(622_180)
  })

  it(`goes negative when the year's payments exceed the cash`, () => {
    const s = splitOutstanding(90_000, { dueByYearEnd: 90_000, dueLater: 0, undated: 0 })
    expect(headroom(50_000, s)).toBe(-40_000)
  })
})
