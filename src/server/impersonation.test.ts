import { describe, it, expect } from 'vitest'
import { __testing } from './session'

// BetterAuth sets an impersonation session to expire in an hour and then, on every
// single request, rewrites that expiry to seven days — because its refresh test assumes
// every session started at the full `expiresIn`. For a one-hour session the test is
// always true. So the cap it advertises never actually binds, and we enforce it here.
//
// Pinned because this is a security control: if it silently stops working, an
// impersonation session quietly lasts a week again and nothing anywhere says so.

const { impersonationExpired, IMPERSONATION_MAX_MS } = __testing

const agesAgo = new Date(Date.now() - IMPERSONATION_MAX_MS - 60_000)
const recently = new Date(Date.now() - 60_000)

describe('impersonationExpired', () => {
  it('expires an impersonation session past its hour', () => {
    expect(impersonationExpired({ impersonatedBy: 'admin-1', createdAt: agesAgo })).toBe(true)
  })

  it('allows one still inside the hour', () => {
    expect(impersonationExpired({ impersonatedBy: 'admin-1', createdAt: recently })).toBe(false)
  })

  it('never touches an ordinary session, however old', () => {
    // The whole point of enforcing it here rather than through BetterAuth's own
    // switches: a normal user's session must be completely unaffected.
    expect(impersonationExpired({ createdAt: agesAgo })).toBe(false)
    expect(impersonationExpired({ impersonatedBy: null, createdAt: agesAgo })).toBe(false)
  })

  it('accepts a string timestamp as well as a Date', () => {
    // Which one arrives depends on the adapter, and getting it wrong in the strict
    // direction would lock superadmins out of impersonation entirely.
    expect(
      impersonationExpired({ impersonatedBy: 'admin-1', createdAt: agesAgo.toISOString() }),
    ).toBe(true)
    expect(
      impersonationExpired({ impersonatedBy: 'admin-1', createdAt: recently.toISOString() }),
    ).toBe(false)
  })

  it('fails open on an unreadable timestamp', () => {
    // Refusing every impersonation session because a date did not parse would break the
    // feature outright, and the row is ours rather than anything a caller controls.
    expect(impersonationExpired({ impersonatedBy: 'admin-1', createdAt: 'not a date' })).toBe(false)
    expect(impersonationExpired({ impersonatedBy: 'admin-1', createdAt: undefined })).toBe(false)
  })
})
