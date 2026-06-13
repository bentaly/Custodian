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

export const ROUND_STATUS_COLORS: Record<RoundStatus, string> = {
  upcoming: 'bg-gray-100 text-gray-600',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}
