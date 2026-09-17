import { describe, expect, it } from 'vitest'
import { holdsAVote, majorityOf } from './voting'

describe('holdsAVote', () => {
  it('gives every trustee a vote, whatever the admin column says', () => {
    expect(holdsAVote({ role: 'trustee' })).toBe(true)
    // The column is only ever written on an admin, but a stale `false` left on a row that
    // was promoted from admin to trustee must not take a trustee's vote away.
    expect(holdsAVote({ role: 'trustee', votesOnApplications: false })).toBe(true)
  })

  it('gives an admin a vote only where the foundation has given them one', () => {
    expect(holdsAVote({ role: 'admin' })).toBe(false)
    expect(holdsAVote({ role: 'admin', votesOnApplications: false })).toBe(false)
    expect(holdsAVote({ role: 'admin', votesOnApplications: true })).toBe(true)
  })

  it('never gives finance a vote, which is the half of the role the hint leaves out', () => {
    // "Trustee access, plus the payment schedule" reads as though they vote. They do not:
    // a finance user is never a grant decision. The column cannot be set on one, but if
    // it ever were, this is the answer that must not change.
    expect(holdsAVote({ role: 'finance' })).toBe(false)
    expect(holdsAVote({ role: 'finance', votesOnApplications: true })).toBe(false)
  })

  it('never gives a superadmin a vote: they sit on no foundation’s board', () => {
    expect(holdsAVote({ role: 'superadmin', votesOnApplications: true })).toBe(false)
  })
})

describe('majorityOf', () => {
  it('is more than half, so an even board cannot carry on a tie', () => {
    expect(majorityOf(4)).toBe(3)
    expect(majorityOf(2)).toBe(2)
  })

  it('rounds up on an odd board', () => {
    expect(majorityOf(3)).toBe(2)
    expect(majorityOf(5)).toBe(3)
  })

  it('agrees with the `yes * 2 > voters` the queries are written as', () => {
    for (let voters = 1; voters <= 12; voters++) {
      for (let yes = 0; yes <= voters; yes++) {
        expect(yes >= majorityOf(voters)).toBe(yes * 2 > voters)
      }
    }
  })

  it('is zero on an empty board, not a threshold of one nobody can reach', () => {
    expect(majorityOf(0)).toBe(0)
    // And zero yes-votes out of nobody is still not a majority, which is the guard every
    // caller pairs with it (`voterCount > 0 && …`).
    expect(0 * 2 > 0).toBe(false)
  })
})
