import { describe, expect, it } from 'vitest'
import { pickWaitingGrant } from './match'

// The charity-number link attaches a report with no reference automatically, so it
// must only ever pick a grant when there is nothing to choose between.

describe('pickWaitingGrant', () => {
  it('links to the one grant still waiting on a report', () => {
    expect(pickWaitingGrant([{ awardId: 'a', programmeName: 'Youth' }], null)).toBe('a')
  })

  it('counts a grant once however many milestones it has open', () => {
    const waiting = [
      { awardId: 'a', programmeName: 'Youth' },
      { awardId: 'a', programmeName: 'Youth' },
    ]
    expect(pickWaitingGrant(waiting, null)).toBe('a')
  })

  it('holds when nothing is waiting', () => {
    expect(pickWaitingGrant([], 'Youth')).toBeNull()
  })

  it('holds when two grants are waiting and no programme is named', () => {
    const waiting = [
      { awardId: 'a', programmeName: 'Youth' },
      { awardId: 'b', programmeName: 'Warm Homes' },
    ]
    expect(pickWaitingGrant(waiting, null)).toBeNull()
    expect(pickWaitingGrant(waiting, '  ')).toBeNull()
  })

  it('lets a named programme settle it, case and spacing aside', () => {
    const waiting = [
      { awardId: 'a', programmeName: 'Youth' },
      { awardId: 'b', programmeName: 'Warm Homes' },
    ]
    expect(pickWaitingGrant(waiting, ' warm homes ')).toBe('b')
  })

  it('holds when the named programme still leaves two grants', () => {
    const waiting = [
      { awardId: 'a', programmeName: 'Youth' },
      { awardId: 'b', programmeName: 'Youth' },
    ]
    expect(pickWaitingGrant(waiting, 'Youth')).toBeNull()
  })

  it('holds when the named programme matches none of them', () => {
    const waiting = [
      { awardId: 'a', programmeName: 'Youth' },
      { awardId: 'b', programmeName: 'Warm Homes' },
    ]
    expect(pickWaitingGrant(waiting, 'Arts')).toBeNull()
  })
})
