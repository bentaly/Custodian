import { describe, expect, it } from 'vitest'
import {
  LAST_ADMIN_MESSAGE,
  LAST_ADMIN_SELF_MESSAGE,
  archivedEmail,
  deviceLabel,
  removalRefusal,
  roleChangeRefusal,
  voteChangeRefusal,
  type TeamPerson,
} from './team'

const CLIENT = 'client-1'
const person = (over: Partial<TeamPerson> & { id: string }): TeamPerson => ({
  role: 'trustee',
  clientId: CLIENT,
  archivedAt: null,
  ...over,
})

const admin = person({ id: 'admin-1', role: 'admin' })
const otherAdmin = person({ id: 'admin-2', role: 'admin' })
const trustee = person({ id: 'trustee-1' })

describe('removalRefusal from Settings → Team', () => {
  it('lets an admin remove a trustee', () => {
    expect(removalRefusal({ actor: admin, target: trustee, activeAdmins: 1, via: 'team' })).toBe(
      null,
    )
  })

  it('lets an admin remove another admin while one is left', () => {
    expect(removalRefusal({ actor: admin, target: otherAdmin, activeAdmins: 2, via: 'team' })).toBe(
      null,
    )
  })

  it('refuses the last admin', () => {
    // Reachable when a superadmin is working inside the tenant and the foundation has one admin.
    const superadmin = person({ id: 'sa', role: 'superadmin' })
    expect(removalRefusal({ actor: superadmin, target: admin, activeAdmins: 1, via: 'team' })).toBe(
      LAST_ADMIN_MESSAGE,
    )
  })

  it('refuses a trustee or finance user acting as if they were an admin', () => {
    const finance = person({ id: 'f', role: 'finance' })
    expect(
      removalRefusal({ actor: finance, target: trustee, activeAdmins: 1, via: 'team' }),
    ).toMatch(/Only an admin/)
  })

  it('sends you to Profile to remove yourself, where the code is', () => {
    expect(removalRefusal({ actor: admin, target: admin, activeAdmins: 2, via: 'team' })).toMatch(
      /Profile/,
    )
  })

  it('treats a member of another foundation as not found', () => {
    const elsewhere = person({ id: 'x', clientId: 'client-2' })
    expect(
      removalRefusal({ actor: admin, target: elsewhere, activeAdmins: 1, via: 'team' }),
    ).toMatch(/could not find/)
  })

  it('never removes a platform account', () => {
    const superadmin = person({ id: 'sa', role: 'superadmin', clientId: null })
    expect(
      removalRefusal({ actor: admin, target: superadmin, activeAdmins: 1, via: 'team' }),
    ).toMatch(/Platform/)
  })

  it('refuses someone already removed', () => {
    const gone = person({ id: 'g', archivedAt: new Date('2026-09-01') })
    expect(removalRefusal({ actor: admin, target: gone, activeAdmins: 1, via: 'team' })).toMatch(
      /already been removed/,
    )
  })
})

describe('removalRefusal from Profile', () => {
  it('lets a trustee remove their own account', () => {
    expect(removalRefusal({ actor: trustee, target: trustee, activeAdmins: 1, via: 'self' })).toBe(
      null,
    )
  })

  it('lets an admin go when another admin remains', () => {
    expect(removalRefusal({ actor: admin, target: admin, activeAdmins: 2, via: 'self' })).toBe(null)
  })

  it('stops the only admin, and says what to do about it', () => {
    expect(removalRefusal({ actor: admin, target: admin, activeAdmins: 1, via: 'self' })).toBe(
      LAST_ADMIN_SELF_MESSAGE,
    )
  })

  it('only ever acts on your own account', () => {
    expect(removalRefusal({ actor: admin, target: trustee, activeAdmins: 1, via: 'self' })).toMatch(
      /your own account/,
    )
  })

  it('never removes a superadmin', () => {
    const superadmin = person({ id: 'sa', role: 'superadmin', clientId: null })
    expect(
      removalRefusal({ actor: superadmin, target: superadmin, activeAdmins: 0, via: 'self' }),
    ).toMatch(/Platform/)
  })
})

describe('roleChangeRefusal', () => {
  it('lets an admin promote a trustee', () => {
    expect(
      roleChangeRefusal({ actor: admin, target: trustee, nextRole: 'admin', activeAdmins: 1 }),
    ).toBe(null)
  })

  it('lets an admin step down while another admin remains', () => {
    expect(
      roleChangeRefusal({ actor: admin, target: admin, nextRole: 'trustee', activeAdmins: 2 }),
    ).toBe(null)
  })

  it('refuses to demote the last admin', () => {
    expect(
      roleChangeRefusal({ actor: admin, target: admin, nextRole: 'finance', activeAdmins: 1 }),
    ).toBe(LAST_ADMIN_MESSAGE)
  })

  it('refuses a role that cannot be invited, superadmin included', () => {
    expect(
      roleChangeRefusal({ actor: admin, target: trustee, nextRole: 'superadmin', activeAdmins: 1 }),
    ).toMatch(/not a role/)
  })

  it('refuses a no-op', () => {
    expect(
      roleChangeRefusal({ actor: admin, target: trustee, nextRole: 'trustee', activeAdmins: 1 }),
    ).toMatch(/already have/)
  })

  it('refuses a non-admin', () => {
    expect(
      roleChangeRefusal({ actor: trustee, target: trustee, nextRole: 'admin', activeAdmins: 1 }),
    ).toMatch(/Only an admin/)
  })

  it('refuses an archived member', () => {
    const gone = person({ id: 'g', archivedAt: new Date() })
    expect(
      roleChangeRefusal({ actor: admin, target: gone, nextRole: 'finance', activeAdmins: 1 }),
    ).toMatch(/removed/)
  })
})

describe('archivedEmail', () => {
  it('is unique per user and undeliverable', () => {
    expect(archivedEmail('abc')).toBe('abc@archived.custodian.invalid')
    expect(archivedEmail('abc')).not.toBe(archivedEmail('abd'))
  })
})

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      'Edge on Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
  ])('names %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label)
  })

  it('admits when it cannot tell', () => {
    expect(deviceLabel(null)).toBe('Unknown device')
    expect(deviceLabel('curl/8.4.0')).toBe('Unknown device')
  })
})

describe('voteChangeRefusal', () => {
  it('lets an admin give another admin a vote', () => {
    expect(voteChangeRefusal({ actor: admin, target: otherAdmin })).toBe(null)
  })

  it('lets an admin give THEMSELVES a vote, unlike every other action on this screen', () => {
    // The point of the feature: the foundation whose admin also sits on the board is
    // usually the foundation with one admin, so a rule barring self-service would leave
    // it unreachable by the people who asked for it. Removal and role changes stay barred.
    expect(voteChangeRefusal({ actor: admin, target: admin })).toBe(null)
    expect(removalRefusal({ actor: admin, target: admin, activeAdmins: 2, via: 'team' })).toBe(
      'To remove your own account, go to your Profile.',
    )
  })

  it('refuses a trustee, who already votes, and a finance user, who never does', () => {
    expect(voteChangeRefusal({ actor: admin, target: trustee })).toBe(
      'Trustees already vote on applications.',
    )
    expect(
      voteChangeRefusal({ actor: admin, target: person({ id: 'fin-1', role: 'finance' }) }),
    ).toBe('Only an admin can be given a vote on applications.')
  })

  it('refuses a non-admin actor, an archived target and another tenant', () => {
    expect(voteChangeRefusal({ actor: trustee, target: otherAdmin })).toBe(
      'Only an admin can change who votes.',
    )
    expect(
      voteChangeRefusal({
        actor: admin,
        target: person({ id: 'admin-3', role: 'admin', archivedAt: new Date() }),
      }),
    ).toBe('They have been removed from the team.')
    expect(
      voteChangeRefusal({
        actor: admin,
        target: person({ id: 'admin-4', role: 'admin', clientId: 'client-2' }),
      }),
    ).toBe('We could not find that team member.')
  })

  it('refuses a platform account', () => {
    expect(
      voteChangeRefusal({ actor: admin, target: person({ id: 'sa', role: 'superadmin' }) }),
    ).toBe('Platform accounts cannot be changed here.')
  })
})
