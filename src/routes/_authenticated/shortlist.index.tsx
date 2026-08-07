import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { Coins01Icon, PieChartIcon, ThumbsUpDownIcon } from '@hugeicons/core-free-icons'
import { listShortlist } from '../../server/fns/shortlist'
import { listMyRounds } from '../../server/fns/rounds'
import { VoteCard } from '../../components/shortlist/VoteCard'
import { BarMeter } from '../../components/BarMeter'
import { getRoundStatus } from '../../lib/roundStatus'
import { fmtCompact, fmtMoney } from '../../lib/format'
import { EmptyState, KPI_TINTS, MiniKpi, RoundSelect, roundStatusLabel } from '../../components/ui'
import { C } from '../../components/ui/tokens'

// Design tokens (Figma variables — pinned until the token set lands), matching the
// applications list so the two screens read as one app.

/** Rounds a shortlist can exist in — an upcoming round has nothing shortlisted yet. */
function selectableRounds<
  T extends { openedAt: Date | string | null; closedAt: Date | string | null },
>(rounds: T[]): T[] {
  return rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
      const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
      return bT - aT
    })
}

export const Route = createFileRoute('/_authenticated/shortlist/')({
  validateSearch: (search: Record<string, unknown>) => ({
    roundId:
      typeof search.roundId === 'string' ? search.roundId : (undefined as string | undefined),
  }),
  // The shortlist is always ABOUT a round — a board sits for one round, and spend
  // against a budget only means anything within one. So there is no "all rounds":
  // arriving without a round lands you on the most recent one.
  beforeLoad: async ({ search }) => {
    if (search.roundId) return
    const fallback = selectableRounds(await listMyRounds())[0]
    if (fallback) throw redirect({ to: '/shortlist', search: { roundId: fallback.id } })
  },
  loaderDeps: ({ search }) => ({ roundId: search.roundId }),
  loader: async ({ deps }) => {
    const [shortlist, rounds] = await Promise.all([
      listShortlist({ data: { roundId: deps.roundId } }),
      listMyRounds(),
    ])
    return { shortlist, rounds }
  },
  component: ShortlistPage,
})

function ShortlistPage() {
  const navigate = useNavigate({ from: '/shortlist' })
  const { roundId } = Route.useSearch()
  const { shortlist, rounds } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { items, trustees, allowAdminVoting, budgets } = shortlist

  const isAdmin = user.role === 'admin' || user.role === 'superadmin'
  const visibleRounds = selectableRounds(rounds)
  const selectedRound = rounds.find((r) => r.id === roundId)

  const totalProposed = items.reduce((sum, a) => sum + parseFloat(a.amountRequested), 0)
  const approved = items.filter((a) => a.hasMajority)
  const oneShort = items.filter((a) => !a.hasMajority && a.oneVoteShort && a.yesVotes > 0)
  const unstarted = items.filter((a) => a.votes.length === 0)

  // Who still owes a vote, and on how many. The board's actual blocker is usually a
  // person rather than an application, so name them.
  const outstandingByTrustee = trustees
    .map((t) => ({
      ...t,
      outstanding: items.filter((a) => !a.votes.some((v) => v.userId === t.id)).length,
    }))
    .filter((t) => t.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)

  const budgeted = budgets.filter((b) => b.budget !== null)
  const budgetTotal = budgeted.reduce((s, b) => s + (b.budget ?? 0), 0)
  const committedTotal = budgeted.reduce((s, b) => s + b.committed, 0)
  const proposedInBudgeted = budgeted.reduce((s, b) => s + b.proposed, 0)
  const headroom = budgetTotal - committedTotal - proposedInBudgeted
  const overspent = headroom < 0

  const metaLine = [
    `${items.length} shortlisted`,
    items.length > 0 ? `${fmtMoney(totalProposed)} proposed` : null,
    approved.length > 0 ? `${approved.length} board approved` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header: title, then the round pill beneath it (as Applications) ── */}
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
          Shortlist
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {visibleRounds.length > 0 && (
              <RoundSelect
                rounds={visibleRounds}
                value={roundId}
                statusLabel={roundStatusLabel(selectedRound)}
                onChange={(id) => navigate({ search: { roundId: id } })}
              />
            )}
            <span
              className="whitespace-nowrap font-display text-[12px] font-medium"
              style={{ color: C.sub }}
            >
              {metaLine}
            </span>
          </div>
          {isAdmin && approved.length > 0 && (
            <Link
              to="/shortlist/set-up-awards"
              search={{ roundId }}
              className="rounded-[12px] px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: C.brand }}
            >
              Set up {approved.length === 1 ? 'award' : `${approved.length} awards`} →
            </Link>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState>
          <p className="text-sm font-medium text-gray-500">Nothing shortlisted in this round</p>
          <p className="mt-1 text-xs text-gray-400">
            Open an application and add it to the shortlist to bring it to the board.
          </p>
          <Link
            to="/applications"
            search={{ roundId }}
            className="mt-4 inline-block rounded-sm border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Go to Applications →
          </Link>
        </EmptyState>
      ) : (
        <>
          {/* ── The three questions a board asks ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MiniKpi
              tint={KPI_TINTS.violet}
              icon={Coins01Icon}
              label="Proposed this round"
              value={fmtMoney(totalProposed)}
              sub={`across ${items.length} application${items.length === 1 ? '' : 's'}`}
            >
              <div className="mt-3 space-y-1.5">
                {budgets.slice(0, 4).map((b) => (
                  <div key={b.roundProgrammeId} className="flex justify-between gap-2 text-[11px]">
                    <span className="truncate" style={{ color: C.sub }}>
                      {b.programmeName}
                    </span>
                    <span className="shrink-0 font-medium" style={{ color: C.ink }}>
                      {fmtCompact(b.proposed)}
                    </span>
                  </div>
                ))}
              </div>
            </MiniKpi>

            <MiniKpi
              tint={overspent ? KPI_TINTS.pink : KPI_TINTS.green}
              icon={PieChartIcon}
              label="Against the round budget"
              value={budgeted.length === 0 ? 'No budget set' : fmtMoney(Math.abs(headroom))}
              valueColor={overspent ? C.danger : undefined}
              sub={
                budgeted.length === 0
                  ? 'set one on the round to see headroom'
                  : overspent
                    ? 'over budget if all are funded'
                    : `headroom left of ${fmtMoney(budgetTotal)}`
              }
            >
              {budgeted.length > 0 && (
                <div className="mt-3 space-y-2">
                  {budgeted.slice(0, 4).map((b) => {
                    const budget = b.budget ?? 0
                    const spend = b.committed + b.proposed
                    return (
                      <div key={b.roundProgrammeId}>
                        <div className="flex justify-between gap-2 text-[11px]">
                          <span className="truncate" style={{ color: C.sub }}>
                            {b.programmeName}
                          </span>
                          <span
                            className="shrink-0 font-medium"
                            style={{ color: spend > budget ? C.danger : C.ink }}
                          >
                            {fmtCompact(spend)} / {fmtCompact(budget)}
                          </span>
                        </div>
                        {/* Three segments — committed in this round, what this
                            shortlist would add on top, then the unspent remainder.
                            The remainder is explicit because BarMeter's segment mode
                            always fills the strip; without it the bar would read as
                            "fully spent" at every level of spend. */}
                        <BarMeter
                          className="mt-1"
                          height={12}
                          bars={24}
                          segments={[
                            { value: b.committed, color: C.brand },
                            { value: b.proposed, color: spend > budget ? C.danger : '#7FC3A6' },
                            { value: Math.max(0, budget - spend), color: C.line },
                          ]}
                        />
                      </div>
                    )
                  })}
                  <p className="pt-0.5 text-[10.5px]" style={{ color: C.faint }}>
                    {fmtMoney(committedTotal)} already committed this round
                  </p>
                </div>
              )}
            </MiniKpi>

            <MiniKpi
              tint={KPI_TINTS.amber}
              icon={ThumbsUpDownIcon}
              label="Board decision"
              value={`${approved.length} of ${items.length}`}
              sub="approved and ready to award"
            >
              <div className="mt-3 space-y-1.5 text-[11px]">
                {oneShort.length > 0 && (
                  <div style={{ color: C.amber }}>
                    <strong>{oneShort.length}</strong> one vote short
                  </div>
                )}
                {unstarted.length > 0 && (
                  <div style={{ color: C.sub }}>
                    <strong>{unstarted.length}</strong> with no votes yet
                  </div>
                )}
                {outstandingByTrustee.length > 0 && (
                  <div className="border-t pt-1.5" style={{ borderColor: C.line }}>
                    <div
                      className="mb-1 text-[10px] font-semibold uppercase tracking-[.04em]"
                      style={{ color: C.faint }}
                    >
                      Still to vote
                    </div>
                    {outstandingByTrustee.slice(0, 3).map((t) => (
                      <div key={t.id} className="flex justify-between gap-2">
                        <span className="truncate" style={{ color: C.sub }}>
                          {t.name}
                        </span>
                        <span className="shrink-0" style={{ color: C.faint }}>
                          {t.outstanding}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {outstandingByTrustee.length === 0 && trustees.length > 0 && (
                  <div style={{ color: C.brand }}>Every trustee has voted on everything.</div>
                )}
                {trustees.length === 0 && (
                  <div style={{ color: C.amber }}>
                    No trustees to vote — nothing can be approved.
                  </div>
                )}
              </div>
            </MiniKpi>
          </div>

          {/* ── The applications ── */}
          <div className="flex flex-col gap-4">
            {items.map((app) => (
              <VoteCard
                key={app.id}
                app={app}
                trustees={trustees}
                userId={user.id}
                userRole={user.role}
                allowAdminVoting={allowAdminVoting}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
