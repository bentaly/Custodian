import { describe, expect, it } from 'vitest'
import { settingsStatuses, type SettingsFacts } from './settingsStatus'

const admin: NonNullable<SettingsFacts['admin']> = {
  hasGivingStrategy: true,
  enforceRoundBudget: false,
  allowAdminVoting: false,
  voters: 4,
  replyTo: 'grants@wrenfield.org',
  pendingInvitations: 0,
  activeApiKeys: 2,
}

const facts = (over: Partial<SettingsFacts> = {}): SettingsFacts => ({
  programmes: 4,
  rounds: 3,
  openRounds: 1,
  members: 6,
  budget: { set: true, yearLabel: '2026/27' },
  admin,
  ...over,
})

describe('settingsStatuses', () => {
  it('states a set-up foundation in grey, with no line where there is nothing to say', () => {
    const s = settingsStatuses(facts())
    expect(Object.values(s).every((t) => !t!.attention)).toBe(true)
    expect(s['/settings/giving-strategy']).toBeUndefined()
    expect(s['/programmes']).toEqual({ text: '4 programmes', attention: false })
    expect(s['/rounds']?.text).toBe('1 round open')
    expect(s['/settings/api-keys']?.text).toBe('2 active keys')
    expect(s['/settings/shortlisting']?.text).toBe('Budget is a target, 4 people vote')
  })

  it('flags only what costs the foundation something', () => {
    const s = settingsStatuses(
      facts({
        programmes: 0,
        rounds: 0,
        openRounds: 0,
        admin: { ...admin, hasGivingStrategy: false, replyTo: null, activeApiKeys: 0 },
      }),
    )
    expect(s['/programmes']).toEqual({ text: 'No programmes yet', attention: true })
    expect(s['/rounds']).toEqual({ text: 'No rounds yet', attention: true })
    expect(s['/settings/giving-strategy']).toEqual({ text: 'Not written yet', attention: true })
    expect(s['/settings/letters']).toEqual({ text: 'No reply-to address', attention: true })
    expect(s['/settings/api-keys']).toEqual({ text: 'No keys yet', attention: true })
  })

  it('never flags a missing annual budget, since plenty of foundations never set one', () => {
    const s = settingsStatuses(facts({ budget: { set: false, yearLabel: '2026/27' } }))
    expect(s['/settings/budget']).toEqual({ text: 'Not set for 2026/27', attention: false })
  })

  it('does not call rounds that all closed a problem', () => {
    expect(settingsStatuses(facts({ openRounds: 0 }))['/rounds']).toEqual({
      text: 'No round open',
      attention: false,
    })
  })

  it('withholds admin and money lines from anyone who cannot see those tiles', () => {
    const s = settingsStatuses(facts({ admin: null, budget: null }))
    expect(Object.keys(s).sort()).toEqual(['/programmes', '/rounds', '/settings/team'])
    expect(s['/settings/team']?.text).toBe('6 members')
  })

  it('counts pending invitations beside the team, singular and plural', () => {
    const one = settingsStatuses(facts({ members: 1, admin: { ...admin, pendingInvitations: 1 } }))
    expect(one['/settings/team']?.text).toBe('1 member, 1 invitation pending')
    const two = settingsStatuses(facts({ admin: { ...admin, pendingInvitations: 2 } }))
    expect(two['/settings/team']?.text).toBe('6 members, 2 invitations pending')
  })
})
