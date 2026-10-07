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

/**
 * The round a screen is ABOUT: the open one, else the one that closed most recently,
 * else — nothing having run yet — the one opening soonest.
 *
 * Lives here, tested, because the obvious spelling is wrong in a way that looks right.
 * The dashboard used to take "the open round, else the most recent" from a list ordered
 * `opened_at DESC` and read `[0]`, which is neither: an UPCOMING round's opening date
 * is in the future and therefore the largest, and Postgres puts NULLs first on a DESC
 * sort, so a round with no dates at all outranks even that. Between rounds it focused
 * the round that had not started — an empty funnel and an untouched budget meter.
 *
 * A missing date sorts last within its branch: it cannot be the most recent anything.
 * Ties break on nothing in particular; two rounds closing on the same date are equally
 * good answers.
 */
export function pickFocusRound<
  T extends {
    openedAt: Date | string | null | undefined
    closedAt: Date | string | null | undefined
  },
>(rounds: readonly T[]): T | null {
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null)
  const withStatus = rounds.map((round) => ({ round, status: getRoundStatus(round) }))
  const pick = (status: RoundStatus, rank: (r: T) => number | null) =>
    withStatus
      .filter((r) => r.status === status)
      .map((r) => ({ round: r.round, key: rank(r.round) }))
      .sort((a, b) => (b.key ?? -Infinity) - (a.key ?? -Infinity))[0]?.round ?? null
  return (
    pick('open', (r) => time(r.openedAt)) ??
    pick('closed', (r) => time(r.closedAt)) ??
    // Negated so the one opening SOONEST wins the shared descending sort.
    pick('upcoming', (r) => {
      const t = time(r.openedAt)
      return t === null ? null : -t
    })
  )
}

/**
 * The rounds a round pill offers (Applications, Shortlist, Set up awards), in the order
 * it lists them: open rounds first, most recently opened on top, then closed ones, most
 * recently CLOSED on top. Upcoming rounds are left out — nothing has arrived in them.
 *
 * The first entry is the screen's default round, and is `pickFocusRound` over the same
 * rounds, so the pill's top row and the dashboard's focus round always agree. The three
 * screens each sorted on `openedAt` alone until 2026-10-07, which made the default a
 * coin toss between rounds opening on the same day: Montirex runs two that opened on
 * 1 May, and Applications landed on the one that closed in May rather than August.
 */
export function selectableRounds<
  T extends {
    openedAt: Date | string | null | undefined
    closedAt: Date | string | null | undefined
  },
>(rounds: readonly T[]): T[] {
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : -Infinity)
  const rank = (r: T) => (getRoundStatus(r) === 'open' ? 1 : 0)
  return rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort(
      (a, b) =>
        rank(b) - rank(a) ||
        (rank(a) === 1
          ? time(b.openedAt) - time(a.openedAt) || time(b.closedAt) - time(a.closedAt)
          : time(b.closedAt) - time(a.closedAt) || time(b.openedAt) - time(a.openedAt)),
    )
}
