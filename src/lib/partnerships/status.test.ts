import { describe, expect, it } from 'vitest'
import {
  canTransition,
  PARTNERSHIP_ACTION_META,
  PARTNERSHIP_STATUS_META,
  PARTNERSHIP_STATUSES,
  PARTNERSHIP_TABS,
  statusesForTab,
  type PartnershipStatus,
} from './status'

describe('the partnership pipeline', () => {
  // The tabs are a partition of the statuses, not a filter over them. If a status ever
  // belongs to no tab it becomes invisible — a prospect logged and then unreachable —
  // and if it belongs to two, the tab counts add up to more than the pipeline.
  it('puts every status in exactly one tab', () => {
    const seen = PARTNERSHIP_TABS.flatMap((t) => statusesForTab(t.id))
    expect([...seen].sort()).toEqual([...PARTNERSHIP_STATUSES].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })

  // `actOnPartnership` re-checks this against the status the row is ACTUALLY in, so a
  // screen left open on yesterday's state cannot invite an organisation somebody has
  // since declined.
  it('refuses a move the current status does not offer', () => {
    expect(canTransition('declined', 'invite')).toBe(false)
    expect(canTransition('invited', 'issue_eoi')).toBe(false)
    expect(canTransition('prospective', 'reopen')).toBe(false)
  })

  it('allows the moves the screen draws buttons for', () => {
    for (const status of PARTNERSHIP_STATUSES) {
      for (const action of PARTNERSHIP_STATUS_META[status].actions) {
        expect(canTransition(status, action)).toBe(true)
      }
    }
  })

  // Every offered move has to land somewhere the pipeline recognises, and nowhere the
  // record already is — a button that produces no change reads as a broken button.
  it('lands every action on a different, known status', () => {
    for (const status of PARTNERSHIP_STATUSES) {
      for (const action of PARTNERSHIP_STATUS_META[status].actions) {
        const to = PARTNERSHIP_ACTION_META[action].to
        expect(PARTNERSHIP_STATUSES).toContain(to)
        expect(to).not.toBe(status)
      }
    }
  })

  // The three tabs are the three answers to "whose move is it", and the To action tab
  // is the screen's whole reason for existing: it must hold the states where the
  // foundation is the one holding things up, and only those.
  it('counts only the foundation’s own moves as work', () => {
    expect(statusesForTab('to_action').sort()).toEqual(
      (['eoi_received', 'prospective'] as PartnershipStatus[]).sort(),
    )
    expect(statusesForTab('awaiting').sort()).toEqual(
      (['eoi_issued', 'invited'] as PartnershipStatus[]).sort(),
    )
    expect(statusesForTab('closed')).toEqual(['declined'])
  })
})
