import { describe, it, expect } from 'vitest'
import { getRoundStatus, pickFocusRound } from './roundStatus'

const day = 86_400_000
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * day)
const round = (name: string, openedAt: Date | null, closedAt: Date | null) => ({
  name,
  openedAt,
  closedAt,
})

describe('getRoundStatus', () => {
  it('reads closed before open — a round that has opened AND closed is closed', () => {
    expect(getRoundStatus(round('r', at(-30), at(-1)))).toBe('closed')
  })
  it('is open once it has opened and while it has no closing date', () => {
    expect(getRoundStatus(round('r', at(-30), null))).toBe('open')
    expect(getRoundStatus(round('r', at(-30), at(7)))).toBe('open')
  })
  it('is upcoming before it opens, and with no dates at all', () => {
    expect(getRoundStatus(round('r', at(7), at(60)))).toBe('upcoming')
    expect(getRoundStatus(round('r', null, null))).toBe('upcoming')
  })
})

describe('pickFocusRound', () => {
  it('takes the open round over anything else', () => {
    const open = round('open', at(-10), at(20))
    const picked = pickFocusRound([
      round('next', at(30), at(60)),
      round('last', at(-90), at(-30)),
      open,
    ])
    expect(picked?.name).toBe('open')
  })

  it('takes the most recently OPENED round when two are open', () => {
    const picked = pickFocusRound([round('older', at(-40), null), round('newer', at(-5), null)])
    expect(picked?.name).toBe('newer')
  })

  // The bug this function exists for: ordering on `openedAt` puts the round that has
  // not started yet first, because its opening date is the furthest in the future.
  it('falls back to the last CLOSED round, not the next one to open', () => {
    const picked = pickFocusRound([round('next', at(30), at(60)), round('last', at(-90), at(-30))])
    expect(picked?.name).toBe('last')
  })

  it('takes the most recently CLOSED round, which is not the most recently opened', () => {
    const picked = pickFocusRound([
      // Opened later but closed sooner — a short round run inside a long one.
      round('short', at(-40), at(-35)),
      round('long', at(-90), at(-2)),
    ])
    expect(picked?.name).toBe('long')
  })

  // The second half of the bug: Postgres sorts NULLs FIRST on a DESC ordering, so a
  // round with no dates led the list and won the old `[0]` fallback outright.
  it('never focuses a dateless round while a real one exists', () => {
    expect(
      pickFocusRound([round('draft', null, null), round('last', at(-90), at(-30))])?.name,
    ).toBe('last')
    expect(pickFocusRound([round('draft', null, null), round('open', at(-10), null)])?.name).toBe(
      'open',
    )
  })

  it('shows the soonest upcoming round when nothing has run yet', () => {
    const picked = pickFocusRound([round('later', at(60), null), round('sooner', at(10), null)])
    expect(picked?.name).toBe('sooner')
  })

  it('falls back to a dateless round only when it is all there is', () => {
    expect(pickFocusRound([round('draft', null, null)])?.name).toBe('draft')
    expect(pickFocusRound([])).toBeNull()
  })
})
