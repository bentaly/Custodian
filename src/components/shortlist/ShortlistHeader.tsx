import { useNavigate } from '@tanstack/react-router'
import { RoundSelect, Tabs, roundStatusLabel } from '../ui'
import { C } from '../ui/tokens'

// The header both Shortlist screens wear (Figma 765:3270 / 610:2817): the title, then
// one full-width row holding the round on the left and, on the right, whatever the
// screen itself offers followed by the tab pair.
//
// The tabs are NOT a filter over one screen's rows — they are the two routes, so they
// live here rather than inside either. A screen's own action (To vote's Download PDF)
// used to sit on its own line beneath this row on that reasoning, and it read as a
// button hanging off the bottom of the tabs with nothing to belong to. It comes through
// `actions` now and sits to the LEFT of the tabs — the right-hand cluster reads
// outwards, this screen's action first, then the pair that switches screens.

export type ShortlistTab = 'vote' | 'awards'

export function ShortlistHeader({
  tab,
  roundId,
  rounds,
  toVoteCount,
  readyToAwardCount,
  showTabs,
  actions,
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
  /** This screen's own action, sat immediately left of the tabs. */
  actions?: React.ReactNode
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
        <div className="flex flex-wrap items-center gap-3">
          {actions}
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
    </div>
  )
}
