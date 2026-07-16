import { describe, it, expect, vi, beforeEach } from 'vitest'

// `claimPendingInvite` is the ONLY path that grants a user tenant access, so the
// rule it enforces is worth pinning: an invite may be matched by email alone only
// when the address was proven (Google, or a claimed invite token). Anyone can POST
// /api/auth/sign-up/email as an invited address — staff emails are often public —
// and would otherwise be handed that invite, at its role, by getMe.
const findFirst = vi.fn()
const batch = vi.fn()

vi.mock('./db', () => ({
  getDb: () => ({
    query: { invitations: { findFirst } },
    batch,
    update: () => ({ set: () => ({ where: () => ({}) }) }),
  }),
}))

const { claimPendingInvite } = await import('./invites')

const UNVERIFIED = { id: 'u1', email: 'invited@foundation.org', emailVerified: false }
const VERIFIED = { id: 'u2', email: 'invited@foundation.org', emailVerified: true }

beforeEach(() => {
  findFirst.mockReset()
  batch.mockReset()
  findFirst.mockResolvedValue(undefined)
})

describe('claimPendingInvite', () => {
  it('refuses an unverified email with no token, without even looking for an invite', async () => {
    expect(await claimPendingInvite(UNVERIFIED)).toBeNull()
    // Short-circuits: a pending invite for this address must stay unconsumed and
    // available to the person who actually controls the mailbox.
    expect(findFirst).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
  })

  it('looks up the invite by email when the address is verified (the Google-invitee path)', async () => {
    expect(await claimPendingInvite(VERIFIED)).toBeNull() // null: findFirst stubbed empty
    expect(findFirst).toHaveBeenCalled()
  })

  it('looks up the invite by token even when unverified (the invite-link path)', async () => {
    // Possessing a token mailed to that address is itself proof of control.
    expect(await claimPendingInvite(UNVERIFIED, 'a-real-token')).toBeNull()
    expect(findFirst).toHaveBeenCalled()
  })
})
