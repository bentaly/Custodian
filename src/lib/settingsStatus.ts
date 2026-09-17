/**
 * The status line at the foot of each Settings hub tile: the setting's current value in
 * plain words, or what is missing when that costs the foundation something.
 *
 * `attention` is deliberately narrow. It means "this is not done, and something works
 * worse until it is": no giving strategy (applications are scored against nothing), no
 * reply-to (a grantee's reply goes nowhere the foundation reads), no API key (nothing can
 * arrive), no programmes or rounds (nothing can be applied to). An annual budget is NOT
 * on that list: plenty of foundations never set one, and Finance is a complete screen
 * without it, so a missing budget is stated in grey like any other fact. A hub where every
 * optional feature glows amber teaches people to ignore the amber.
 *
 * A tile with nothing worth saying gets no line at all (Activity, Submission guide, Data
 * import), and so does a giving strategy that has been written: "Written" is a status
 * that tells nobody anything.
 */

export type TileStatus = { text: string; attention: boolean }

/** Keyed on the tile's destination, which is what the hub's cards already carry. */
export type SettingsStatuses = Partial<Record<string, TileStatus>>

export type SettingsFacts = {
  programmes: number
  rounds: number
  openRounds: number
  members: number
  /** Only for someone who may see money: null withholds the tile's line. */
  budget: { set: boolean; yearLabel: string } | null
  /** Only for admins, like the tiles themselves: null withholds the line. */
  admin: {
    hasGivingStrategy: boolean
    enforceRoundBudget: boolean
    allowAdminVoting: boolean
    /** How many people hold a vote on applications — `currentVoterOf`. */
    voters: number
    replyTo: string | null
    pendingInvitations: number
    activeApiKeys: number
  } | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const fact = (text: string): TileStatus => ({ text, attention: false })
const todo = (text: string): TileStatus => ({ text, attention: true })

export function settingsStatuses(f: SettingsFacts): SettingsStatuses {
  const out: SettingsStatuses = {
    '/programmes':
      f.programmes === 0 ? todo('No programmes yet') : fact(plural(f.programmes, 'programme')),
    '/rounds':
      f.rounds === 0
        ? todo('No rounds yet')
        : f.openRounds === 0
          ? fact('No round open')
          : fact(`${plural(f.openRounds, 'round')} open`),
  }

  if (f.budget) {
    out['/settings/budget'] = fact(`${f.budget.set ? 'Set' : 'Not set'} for ${f.budget.yearLabel}`)
  }

  const a = f.admin
  const team = plural(f.members, 'member')
  if (!a) {
    out['/settings/team'] = fact(team)
    return out
  }

  out['/settings/team'] = fact(
    a.pendingInvitations > 0
      ? `${team}, ${plural(a.pendingInvitations, 'invitation')} pending`
      : team,
  )
  if (!a.hasGivingStrategy) out['/settings/giving-strategy'] = todo('Not written yet')
  // The voter count rather than the proxy switch: who votes is the fact a foundation
  // checks on this page, and "admin voting on" was ambiguous the moment an admin could
  // hold a vote as well as record one for somebody else.
  out['/settings/shortlisting'] = fact(
    `Budget is ${a.enforceRoundBudget ? 'a limit' : 'a target'}, ${plural(a.voters, 'person votes', 'people vote')}`,
  )
  out['/settings/letters'] = a.replyTo
    ? fact(`Replies go to ${a.replyTo}`)
    : todo('No reply-to address')
  out['/settings/api-keys'] =
    a.activeApiKeys === 0 ? todo('No keys yet') : fact(`${plural(a.activeApiKeys, 'active key')}`)

  return out
}
