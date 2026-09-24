import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { listShortlist } from '../../server/fns/shortlist'
import { listMyRounds } from '../../server/fns/rounds'
import { myRoundsForFallback } from '../../lib/myRounds'
import { VoteCard } from '../../components/shortlist/VoteCard'
import { ShortlistHeader } from '../../components/shortlist/ShortlistHeader'
import { ProposedSpend } from '../../components/shortlist/SpendCards'
import { getRoundStatus } from '../../lib/roundStatus'
import { holdsAVote } from '../../lib/voting'
import { EmptyState, ExportButton, Pagination, SelectPill, TextLink } from '../../components/ui'
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
    programmeId:
      typeof search.programmeId === 'string'
        ? search.programmeId
        : (undefined as string | undefined),
    page: (Number.isInteger(Number(search.page)) && Number(search.page) > 1
      ? Number(search.page)
      : undefined) as number | undefined,
  }),
  // The shortlist is always ABOUT a round — a board sits for one round, and spend
  // against a budget only means anything within one. So there is no "all rounds":
  // arriving without a round lands you on the most recent one.
  beforeLoad: async ({ search }) => {
    if (search.roundId) return
    const fallback = selectableRounds(await myRoundsForFallback())[0]
    if (fallback)
      throw redirect({
        to: '/shortlist',
        search: { roundId: fallback.id, programmeId: undefined, page: undefined },
      })
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
  const { roundId, programmeId, page } = Route.useSearch()
  const { shortlist, rounds } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { items, voters, allowAdminVoting, budgets, financialYear } = shortlist

  // While the print dialogue is open every card is rendered, not just this page: a board
  // pack that silently stopped at the tenth application would be worse than no pack.
  const [printing, setPrinting] = useState(false)

  const isAdmin = user.role === 'admin' || user.role === 'superadmin'
  const visibleRounds = selectableRounds(rounds)
  const approved = items.filter((a) => a.hasMajority)

  // The programme pill, in the place and shape Applications wears it (the in-card `sm`
  // pill, counts in the label). Unlike Applications it offers "All programmes" and
  // starts there: the spend panel above it is the whole round's either way, and a board
  // arriving at its pack must not be shown one programme's applications without asking.
  // Options come from what is shortlisted, so none of them opens onto an empty list.
  const programmeCounts = new Map<string, { name: string; count: number }>()
  for (const a of items) {
    const p = a.roundProgramme.programme
    const entry = programmeCounts.get(p.id) ?? { name: p.name, count: 0 }
    entry.count++
    programmeCounts.set(p.id, entry)
  }
  const programmeOptions = [...programmeCounts]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([value, { name, count }]) => ({ value, label: `${name} (${count})` }))
  // A programme id left in the URL from a link, whose applications have since been
  // decided, falls back to the whole round rather than an empty card.
  const activeProgrammeId =
    programmeId && programmeCounts.has(programmeId) ? programmeId : undefined
  const filtered = activeProgrammeId
    ? items.filter((a) => a.roundProgramme.programme.id === activeProgrammeId)
    : items

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page ?? 1, pageCount)
  const pageItems = printing
    ? filtered
    : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

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
        // The PDF is this screen's alone — a board pack of what is being voted on — so
        // it sits in the header's own right-hand cluster, ahead of the tabs, rather than
        // on a line of its own beneath them.
        actions={
          items.length > 0 && (
            <span className="print:hidden">
              <ExportButton onClick={downloadPdf} label="Download PDF" size="sm" />
            </span>
          )
        }
      />

      {items.length === 0 ? (
        <EmptyState>
          <p className="font-display text-body font-medium" style={{ color: C.sub }}>
            Nothing shortlisted in this round
          </p>
          <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
            Open an application and add it to the shortlist to bring it to the board.{' '}
            <TextLink to="/applications" search={{ roundId }}>
              Go to Applications
            </TextLink>
          </p>
        </EmptyState>
      ) : (
        <>
          <ProposedSpend rows={budgets} financialYearLabel={financialYear?.label ?? null} />

          <div
            className="flex flex-col gap-4 rounded-card border bg-white p-4"
            style={{ borderColor: C.line }}
          >
            {/* Only once there is a choice to make: a round shortlisting from one
                programme would offer "All" and that programme, which are the same list. */}
            {programmeOptions.length > 1 && (
              // Printed with the pack, so a PDF of one programme says which one it is.
              <div>
                <SelectPill
                  size="sm"
                  ariaLabel="Programme"
                  label="Programme"
                  options={programmeOptions}
                  value={activeProgrammeId}
                  clearLabel="All programmes"
                  onChange={(v) =>
                    navigate({
                      search: (prev) => ({ ...prev, programmeId: v || undefined, page: undefined }),
                    })
                  }
                />
              </div>
            )}

            <p className="font-display text-title font-medium" style={{ color: C.ink }}>
              To vote{' '}
              <span style={{ color: C.faint }}>
                · {filtered.length} shortlisted application{filtered.length === 1 ? '' : 's'}{' '}
                awaiting a decision
              </span>
            </p>

            <div className="flex flex-col gap-4">
              {pageItems.map((app) => (
                <VoteCard
                  key={app.id}
                  app={app}
                  voters={voters}
                  userId={user.id}
                  userRole={user.role}
                  iVote={holdsAVote(user)}
                  allowAdminVoting={allowAdminVoting}
                />
              ))}
            </div>

            <div className="print:hidden">
              <Pagination
                page={currentPage}
                pageCount={pageCount}
                shown={pageItems.length}
                total={filtered.length}
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
