export type RoundStatus = 'upcoming' | 'open' | 'closed'

export function getRoundStatus(round: {
  openedAt: Date | string | null | undefined
  closedAt: Date | string | null | undefined
}): RoundStatus {
  const now = new Date()
  const openedAt = round.openedAt ? new Date(round.openedAt) : null
  const closedAt = round.closedAt ? new Date(round.closedAt) : null
  if (closedAt && closedAt <= now) return 'closed'
  if (openedAt && openedAt <= now) return 'open'
  return 'upcoming'
}

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  upcoming: 'Upcoming',
  open: 'Open',
  closed: 'Closed',
}

// Straight from the Rounds comp (672:26812). Closed is GREY, not red: a round that has
// run its course is the ordinary end state, and the previous danger tint made every
// past round read as something gone wrong.
export const ROUND_STATUS_COLOURS: Record<RoundStatus, string> = {
  upcoming: 'bg-accent-violet/10 text-accent-violet',
  open: 'bg-success/10 text-success',
  closed: 'bg-grey-100 text-grey-500',
}
