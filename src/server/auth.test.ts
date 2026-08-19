import { describe, it, expect, vi, beforeEach } from 'vitest'

// The isolate-poisoning bug this guards against (better-auth #10315) cannot be
// reproduced with a rejecting promise, because the whole point is that the promise
// NEVER settles — workerd abandons it rather than rejecting it. So the stall here is a
// promise that does nothing, and the assertion is that we stop waiting anyway AND throw
// the poisoned instance away. Detecting the stall without the reset would leave every
// later request hitting the same dead promise.

process.env['BETTER_AUTH_SECRET'] = 'test-secret'
process.env['DATABASE_URL'] = 'postgresql://user:pass@ep-test.eu-west-2.aws.neon.tech/db'

let built = 0
const stalls: boolean[] = []

vi.mock('better-auth', () => ({
  betterAuth: () => {
    built++
    return {
      api: {
        getSession: () =>
          stalls.shift() ? new Promise(() => {}) : Promise.resolve({ user: { id: 'u1' } }),
      },
    }
  },
}))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: () => ({}) }))
vi.mock('better-auth/plugins', () => ({ admin: () => ({}), emailOTP: () => ({}) }))
vi.mock('better-auth/plugins/access', () => ({
  createAccessControl: () => ({ newRole: () => ({}) }),
}))
vi.mock('better-auth/plugins/admin/access', () => ({ defaultStatements: {} }))

const { callAuth, isAuthStalled } = await import('./auth')

beforeEach(() => {
  built = 0
  stalls.length = 0
})

describe('callAuth', () => {
  it('gives up on a stall that never settles, and discards the instance', async () => {
    vi.useFakeTimers()
    try {
      stalls.push(true)

      const first = callAuth('getSession', (a) => a.api.getSession())
      const settled = expect(first).rejects.toSatisfy(isAuthStalled)
      await vi.advanceTimersByTimeAsync(5_000)
      await settled

      const builtAfterStall = built

      // The isolate must heal: the next call rebuilds rather than re-awaiting the
      // dead promise on the instance we just gave up on.
      await expect(callAuth('getSession', (a) => a.api.getSession())).resolves.toEqual({
        user: { id: 'u1' },
      })
      expect(built).toBe(builtAfterStall + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses the instance when auth is healthy', async () => {
    // Warm it, then count builds across two more calls: a healthy instance must be
    // cached, or every request pays to reconstruct the whole plugin surface.
    await callAuth('getSession', (a) => a.api.getSession())
    const before = built

    await callAuth('getSession', (a) => a.api.getSession())
    await callAuth('getSession', (a) => a.api.getSession())

    expect(built).toBe(before)
  })
})
