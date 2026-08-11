import { useNavigate } from '@tanstack/react-router'
import { RoundSelect, Tabs, roundStatusLabel } from '../ui'
import { C } from '../ui/tokens'

// The header both Shortlist screens wear (Figma 765:3270 / 610:2817): the title, then
// one full-width row holding the round on the left and the tab pair on the right.
//
// The tabs are NOT a filter over one screen's rows — they are the two routes, so they
// live here rather than inside either. Anything that belongs to only one of the screens
// (the To vote screen's PDF) goes on its own line beneath this, which is why nothing but
// the round and the tabs is allowed on this row.

export type ShortlistTab = 'vote' | 'awards'

export function ShortlistHeader({
  tab,
  roundId,
  rounds,
  toVoteCount,
  readyToAwardCount,
  showTabs,
}: {
  tab: ShortlistTab
  roundId: string | undefined
  /** Already filtered to the rounds a shortlist can exist in, most recent first. */
  rounds: Array<{
    id: string
    name: string
    openedAt: Date | string | null
    closedAt: Date | string | null
  }>
  toVoteCount: number
  readyToAwardCount: number
  /** Set-up awards is admin-only, and a tab a trustee cannot follow is worse than none. */
  showTabs: boolean
}) {
  const navigate = useNavigate()
  const selectedRound = rounds.find((r) => r.id === roundId)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
        Shortlist
      </h1>
      <div className="flex w-full flex-wrap items-center justify-between gap-4">
        {rounds.length > 0 ? (
          <RoundSelect
            rounds={rounds}
            value={roundId}
            statusLabel={roundStatusLabel(selectedRound)}
            onChange={(id) =>
              navigate({
                to: tab === 'vote' ? '/shortlist' : '/shortlist/set-up-awards',
                search: { roundId: id },
              })
            }
          />
        ) : (
          <span />
        )}
        {showTabs && (
          <Tabs<ShortlistTab>
            ariaLabel="Shortlist view"
            value={tab}
            items={[
              { id: 'vote', label: 'To vote', count: toVoteCount },
              { id: 'awards', label: 'Set up awards', count: readyToAwardCount },
            ]}
            onChange={(next) =>
              next !== tab &&
              navigate({
                to: next === 'vote' ? '/shortlist' : '/shortlist/set-up-awards',
                search: { roundId },
              })
            }
          />
        )}
      </div>
    </div>
  )
}
