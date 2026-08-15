import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { listShortlist } from '../../server/fns/shortlist'
import { listMyRounds } from '../../server/fns/rounds'
import { VoteCard } from '../../components/shortlist/VoteCard'
import { ShortlistHeader } from '../../components/shortlist/ShortlistHeader'
import { ProposedSpend } from '../../components/shortlist/SpendCards'
import { getRoundStatus } from '../../lib/roundStatus'
import { EmptyState, ExportButton, Pagination } from '../../components/ui'
import { C } from '../../components/ui/tokens'

const PAGE_SIZE = 10

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
  // The page is in the URL, as it is on every other list: a board reads this screen in
  // one sitting, opening applications and coming back, and page 3 should still be page 3.
  validateSearch: (search: Record<string, unknown>) => ({
    roundId:
      typeof search.roundId === 'string' ? search.roundId : (undefined as string | undefined),
    page: (Number.isInteger(Number(search.page)) && Number(search.page) > 1
      ? Number(search.page)
      : undefined) as number | undefined,
  }),
  // The shortlist is always ABOUT a round — a board sits for one round, and spend
  // against a budget only means anything within one. So there is no "all rounds":
  // arriving without a round lands you on the most recent one.
  beforeLoad: async ({ search }) => {
    if (search.roundId) return
    const fallback = selectableRounds(await listMyRounds())[0]
    if (fallback) throw redirect({ to: '/shortlist', search: { roundId: fallback.id, page: undefined } })
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
  const navigate = Route.useNavigate()
  const { roundId, page } = Route.useSearch()
  const { shortlist, rounds } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { items, trustees, allowAdminVoting, budgets } = shortlist

  // While the print dialogue is open every card is rendered, not just this page: a board
  // pack that silently stopped at the tenth application would be worse than no pack.
  const [printing, setPrinting] = useState(false)

  const isAdmin = user.role === 'admin' || user.role === 'superadmin'
  const visibleRounds = selectableRounds(rounds)
  const approved = items.filter((a) => a.hasMajority)

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const currentPage = Math.min(page ?? 1, pageCount)
  const pageItems = printing
    ? items
    : items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function downloadPdf() {
    setPrinting(true)
    // Two frames: one for React to commit the full list, one for the browser to lay it
    // out. `print()` blocks until the dialogue closes, so the reset lands after it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print()
        setPrinting(false)
      }),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ShortlistHeader
        tab="vote"
        roundId={roundId}
        rounds={visibleRounds}
        toVoteCount={items.length}
        readyToAwardCount={approved.length}
        showTabs={isAdmin}
      />

      {/* The PDF is this screen's alone — a board pack of what is being voted on — so it
          sits below the round/tab row rather than on it, where it would read as chrome
          belonging to both tabs. */}
      <div className="flex justify-end print:hidden">
        <ExportButton onClick={downloadPdf} label="Download PDF" />
      </div>

      {items.length === 0 ? (
        <EmptyState>
          <p className="font-display text-body font-medium" style={{ color: C.sub }}>
            Nothing shortlisted in this round
          </p>
          <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
            Open an application and add it to the shortlist to bring it to the board.
          </p>
          <Link
            to="/applications"
            search={{ roundId }}
            className="mt-4 inline-block rounded-control border px-4 py-2 font-display text-body hover:bg-grey-50"
            style={{ borderColor: C.line, color: C.body }}
          >
            Go to Applications →
          </Link>
        </EmptyState>
      ) : (
        <>
          <ProposedSpend rows={budgets} />

          <div
            className="flex flex-col gap-4 rounded-card border bg-white p-4"
            style={{ borderColor: C.line }}
          >
            <p className="font-display text-title font-medium" style={{ color: C.ink }}>
              To vote{' '}
              <span style={{ color: C.faint }}>
                · {items.length} shortlisted application{items.length === 1 ? '' : 's'} awaiting a
                decision
              </span>
            </p>

            <div className="flex flex-col gap-4">
              {pageItems.map((app) => (
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

            <div className="print:hidden">
              <Pagination
                page={currentPage}
                pageCount={pageCount}
                shown={pageItems.length}
                total={items.length}
                noun="applications"
                onChange={(p) =>
                  navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
