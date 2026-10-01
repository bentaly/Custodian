import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { listShortlist, type shortlistData } from '../../server/fns/shortlist'
import { listMyRounds } from '../../server/fns/rounds'
import { myRoundsForFallback } from '../../lib/myRounds'
import { VoteCard, type ShortlistVoter } from '../../components/shortlist/VoteCard'
import { ShortlistHeader } from '../../components/shortlist/ShortlistHeader'
import { ProposedSpend } from '../../components/shortlist/SpendCards'
import { getRoundStatus } from '../../lib/roundStatus'
import { holdsAVote } from '../../lib/voting'
import {
  EmptyState,
  ErrorNote,
  ExportMenu,
  Pagination,
  SelectPill,
  TextLink,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { fmtDate } from '../../lib/format'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { downloadTable, type ExportColumn, type ExportFormat } from '../../lib/spreadsheetExport'
import { deliveryAreaLabel, formatDecileRange } from '../../lib/deprivation/types'
import { impactUnitLabel } from '../../lib/impactUnits'
import { majorityOf } from '../../lib/voting'
import { decidedAmount } from '../../lib/amountRequested'

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

// ─── Spreadsheet export ────────────────────────────────────────────────────────

// Off the server fn rather than the loader: `Route.useLoaderData` is typed through the
// generated route tree, which resolves to `any` this far up the file.
type ShortlistItem = Awaited<ReturnType<typeof shortlistData>>['items'][number]

const DUE_DILIGENCE_WORDS: Record<string, string> = {
  clear: 'Clear',
  warning: 'Warnings',
  blocked: 'Blocked',
  review: 'Needs a manual check',
  no_registration: 'No charity or company number',
  pending: 'Not run',
}

/**
 * The shortlist as a table: one row per application, the same facts the cards carry,
 * so a board member who thinks in a spreadsheet can sort and total them.
 *
 * One column per member of the voting board rather than a single "votes" cell: who has
 * and has not voted is the thing people open this to see, and a cell reading "3 of 5"
 * cannot be filtered on. The roster is the one the cards draw (`voters`), so a vote left
 * by somebody no longer on the board is in neither.
 */
function shortlistColumns(voters: ShortlistVoter[]): ExportColumn<ShortlistItem>[] {
  return [
    { header: 'Organisation', width: 36, value: (a) => a.organisationName },
    { header: 'Programme', width: 28, value: (a) => a.roundProgramme.programme.name },
    { header: 'Delivery area', width: 24, value: (a) => deliveryAreaLabel(a) },
    {
      header: 'Amount requested',
      kind: 'money',
      width: 18,
      value: (a) => (a.amountRequested === null ? null : decidedAmount(a.amountRequested)),
    },
    // Blank where nobody has proposed a different figure, so the column reads as "what
    // changed" rather than repeating the ask down the sheet.
    {
      header: 'Amount proposed',
      kind: 'money',
      width: 18,
      value: (a) => (a.amountAmended === null ? null : parseFloat(a.amountAmended)),
    },
    { header: 'This year', kind: 'money', width: 16, value: (a) => a.firstYearAmount },
    {
      header: 'Grant length (years)',
      width: 12,
      value: (a) => a.roundProgramme.grantDurationYears,
    },
    {
      header: 'AI score (out of 100)',
      width: 12,
      value: (a) =>
        a.custodianScoreStatus === 'scored' && a.custodianScore !== null ? a.custodianScore : null,
    },
    {
      header: 'Decision',
      width: 20,
      value: (a) => {
        if (a.hasMajority) return 'Board approved'
        if (a.voterCount === 0) return 'Nobody can vote'
        const needed = Math.max(0, majorityOf(a.voterCount) - a.yesVotes)
        return needed === 1 ? 'Last vote needed' : `${needed} votes needed`
      },
    },
    { header: 'Approved', width: 10, value: (a) => a.yesVotes },
    { header: 'Declined', width: 10, value: (a) => a.noVotes },
    ...voters.map(
      (v): ExportColumn<ShortlistItem> => ({
        header: v.name,
        width: 18,
        value: (a) => {
          const vote = a.votes.find((x) => x.userId === v.id)?.vote
          return vote === 'yes' ? 'Approved' : vote === 'no' ? 'Declined' : 'Pending'
        },
      }),
    ),
    {
      header: 'Proposed impact',
      width: 14,
      value: (a) => (a.proposedImpactQuantity ? Number(a.proposedImpactQuantity) : null),
    },
    {
      header: 'Impact measured in',
      width: 20,
      value: (a) =>
        a.proposedImpactQuantity
          ? impactUnitLabel(
              a.roundProgramme.programme.impactUnit,
              a.roundProgramme.programme.impactUnitLabel,
            )
          : null,
    },
    {
      header: 'Deprivation (IMD)',
      width: 18,
      value: (a) =>
        a.deprivationContext?.status === 'resolved'
          ? formatDecileRange(a.deprivationContext)
          : null,
    },
    {
      header: 'Income (last filed year)',
      kind: 'money',
      width: 18,
      value: (a) => a.organisationProfile?.latestIncome ?? null,
    },
    {
      header: 'Unrestricted reserves',
      kind: 'money',
      width: 18,
      value: (a) => (a.unrestrictedReserves === null ? null : parseFloat(a.unrestrictedReserves)),
    },
    {
      header: 'Due diligence',
      width: 24,
      value: (a) => DUE_DILIGENCE_WORDS[a.dueDiligenceStatus] ?? a.dueDiligenceStatus,
    },
    { header: 'Comments', width: 10, value: (a) => a.commentCount },
    { header: 'Grant purpose', width: 60, value: (a) => a.grantPurpose },
    { header: 'AI assessment', width: 60, value: (a) => a.custodianScoreDetail?.summary },
    {
      header: 'Things to check',
      width: 60,
      value: (a) => (a.custodianScoreDetail?.flags ?? []).join('\n'),
    },
    { header: 'Reference', width: 20, value: (a) => a.externalApplicationId },
  ]
}

function ShortlistPage() {
  const navigate = Route.useNavigate()
  const { roundId, programmeId, page } = Route.useSearch()
  const { shortlist, rounds } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { items, voters, allowAdminVoting, enforceRoundBudget, budgets, financialYear } = shortlist
  const budgetByRp = new Map(budgets.map((b) => [b.roundProgrammeId, b]))
  // Resolved exactly as the Proposed spend panel does (by the row's place in `budgets`
  // for a programme with no colour of its own), so a card's swatch is the meter's.
  const colourByRp = new Map(
    budgets.map((b, i) => [b.roundProgrammeId, resolveProgrammeColour(b.programmeColour, i)]),
  )

  // While the print dialogue is open every card is rendered, not just this page: a board
  // pack that silently stopped at the tenth application would be worse than no pack.
  const [printing, setPrinting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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

  const roundName = visibleRounds.find((r) => r.id === roundId)?.name ?? null
  const programmeName = activeProgrammeId
    ? (programmeCounts.get(activeProgrammeId)?.name ?? null)
    : null

  function downloadPdf() {
    setPrinting(true)
    // The browser offers the page title as the file name, so for the length of the
    // print it names the document rather than the app.
    const title = document.title
    document.title = ['Shortlist', roundName, user.clientName].filter(Boolean).join(' - ')
    // Two frames: one for React to commit the full list, one for the browser to lay it
    // out. `print()` blocks until the dialogue closes, so the reset lands after it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print()
        document.title = title
        setPrinting(false)
      }),
    )
  }

  // What is on screen: the round, narrowed to the programme where one is chosen, and
  // every page of it. Built from the rows already loaded, so the file cannot disagree
  // with the cards.
  async function handleExport(format: ExportFormat) {
    setExporting(true)
    setExportError(null)
    try {
      const round = roundName
      await downloadTable({
        format,
        columns: shortlistColumns(voters),
        rows: filtered,
        filename: `shortlist-${round ?? 'export'}`.replace(/\s+/g, '-'),
        sheetName: 'Shortlist',
      })
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'The export could not be built.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The printed pack's own heading, in place of the screen's: a round pill and a pair
          of tabs are controls, and on paper they say nothing. This says whose shortlist
          it is, which round, how much of it, and when it was printed (votes move). */}
      <div className="hidden border-b pb-3 print:block" style={{ borderColor: C.line }}>
        <p className="font-display text-label font-medium" style={{ color: C.sub }}>
          {user.clientName ?? 'Custodian'}
        </p>
        <h1 className="mt-0.5 font-display text-heading font-medium" style={{ color: C.ink }}>
          Shortlist{roundName ? `: ${roundName}` : ''}
        </h1>
        <p className="mt-1 font-display text-label" style={{ color: C.sub }}>
          {[
            programmeName ?? 'All programmes',
            `${filtered.length} application${filtered.length === 1 ? '' : 's'} awaiting a decision`,
            `as at ${fmtDate(new Date())}`,
          ].join(' · ')}
        </p>
      </div>
      <div className="print:hidden">
        <ShortlistHeader
          tab="vote"
          roundId={roundId}
          rounds={visibleRounds}
          toVoteCount={items.length}
          readyToAwardCount={approved.length}
          showTabs={isAdmin}
          // One Export button, three files. The PDF leads: it is this screen's alone, a
          // board pack of what is being voted on. The spreadsheet is the same shortlist
          // as a table, for whoever would rather sort it than read it. In the header's
          // own right-hand cluster, ahead of the tabs, rather than on a line beneath them.
          actions={
            items.length > 0 && (
              <span className="print:hidden">
                <ExportMenu
                  onExport={handleExport}
                  onPdf={downloadPdf}
                  busy={exporting}
                  size="sm"
                />
              </span>
            )
          }
        />
      </div>
      <ErrorNote error={exportError} />

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

          {/* On paper the outer card goes: it is a frame around frames, and its padding
              is width the cards need. */}
          <div
            className="flex flex-col gap-4 rounded-card border bg-white p-4 print:border-0 print:p-0"
            style={{ borderColor: C.line }}
          >
            {/* Only once there is a choice to make: a round shortlisting from one
                programme would offer "All" and that programme, which are the same list. */}
            {programmeOptions.length > 1 && (
              // Not printed: the pack's heading names the programme in words.
              // A flex row, not a plain block: the pill's menu is at least as wide as
              // the pill's own box, and as a block child that box was the whole card.
              <div className="flex print:hidden">
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

            <p
              className="font-display text-title font-medium print:hidden"
              style={{ color: C.ink }}
            >
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
                  programmeColour={colourByRp.get(app.roundProgrammeId)}
                  amountContext={{
                    financialYearLabel: financialYear?.label ?? 'this year',
                    enforced: enforceRoundBudget,
                    // What the round has left for THIS application: its budget, less
                    // everything else awarded or shortlisted against it this year.
                    budgetRemaining: (() => {
                      const b = budgetByRp.get(app.roundProgrammeId)
                      if (!b || b.budget === null) return null
                      return b.budget - b.committed - b.proposed + app.firstYearAmount
                    })(),
                  }}
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
