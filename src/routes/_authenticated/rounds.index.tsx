import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  Add01Icon,
  ArchiveRestoreIcon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'
import { listRoundsOverview, getRound, setRoundArchived } from '../../server/fns/rounds'
import { listProgrammes } from '../../server/fns/programmes'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { RoundDialog, type RoundDraft } from '../../components/RoundDialog'
import {
  ActionMenu,
  Badge,
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  Pagination,
} from '../../components/ui'
import { messageFor } from '../../lib/errors'

export const Route = createFileRoute('/_authenticated/rounds/')({
  loader: async () => {
    const [rounds, programmes] = await Promise.all([listRoundsOverview(), listProgrammes()])
    return { rounds, programmes }
  },
  component: Rounds,
})

type RoundRow = Awaited<ReturnType<typeof listRoundsOverview>>[number]

const PER_PAGE = 5

function formatDate(date: Date | string | null | undefined) {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return ''
  return new Date(date).toISOString().slice(0, 10)
}

const money = (n: number) => `£${n.toLocaleString('en-GB')}`

function Rounds() {
  const router = useRouter()
  const { rounds, programmes } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [draft, setDraft] = useState<RoundDraft | undefined>()
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Active is "still has something to do": open now, or not started yet. Past is
  // everything closed. Archived rounds sit in Past whatever their dates say — an
  // archived round is finished by decision, not by calendar.
  const active = rounds.filter((r) => !r.archivedAt && getRoundStatus(r) !== 'closed')
  const past = rounds.filter((r) => r.archivedAt || getRoundStatus(r) === 'closed')

  function startNewRound() {
    setError('')
    setDraft({ name: '', openedAt: '', closedAt: '', programmes: [] })
  }

  // The list only carries the figures it displays, so editing fetches the round's own
  // programme rows. Doing it on click rather than up front keeps the screen's payload
  // to one row per round however many programmes each of them funds.
  async function startEdit(id: string) {
    setError('')
    setOpening(id)
    try {
      const round = await getRound({ data: { id } })
      setDraft({
        id: round.id,
        name: round.name,
        openedAt: toDateInput(round.openedAt),
        closedAt: toDateInput(round.closedAt),
        programmes: round.roundProgrammes.map((rp) => ({
          programmeId: rp.programmeId,
          budget: rp.budget,
          maxGrantAmount: rp.maxGrantAmount ?? '',
          grantDurationYears: rp.grantDurationYears?.toString() ?? '',
        })),
      })
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, { label: 'Rounds' }]} />

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-heading font-medium text-gray-900">Funding Rounds</h1>
          <p className="font-display text-label text-gray-500">
            Open and close funding rounds, set their dates, and choose which programmes each round
            funds and with what budget.
          </p>
        </div>
        {canManage && (
          <Button onClick={startNewRound} icon={Add01Icon}>
            New round
          </Button>
        )}
      </div>

      {error && <p className="font-display text-body text-danger">{error}</p>}

      {rounds.length === 0 ? (
        <EmptyState>
          <p className="font-display text-body text-gray-500">No funding rounds yet.</p>
          {canManage && (
            <p className="mt-1 font-display text-body text-gray-400">
              Create your first round to get started.
            </p>
          )}
        </EmptyState>
      ) : (
        <>
          <RoundSection
            title="Active"
            rounds={active}
            canManage={canManage}
            opening={opening}
            onEdit={startEdit}
            empty="No open or upcoming rounds."
          />
          <RoundSection
            title="Past Rounds"
            rounds={past}
            canManage={canManage}
            opening={opening}
            onEdit={startEdit}
            empty="No past rounds yet."
          />
        </>
      )}

      <RoundDialog
        open={draft !== undefined}
        draft={draft}
        programmes={programmes}
        onClose={() => setDraft(undefined)}
        onSaved={() => {
          setDraft(undefined)
          router.invalidate()
        }}
      />
    </div>
  )
}

function RoundSection({
  title,
  rounds,
  canManage,
  opening,
  onEdit,
  empty,
}: {
  title: string
  rounds: RoundRow[]
  canManage: boolean
  opening: string | null
  onEdit: (id: string) => void
  empty: string
}) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rounds.length / PER_PAGE))
  // A round deleted or archived out of this section can leave the pager past the end.
  const current = Math.min(page, pageCount)
  const shown = rounds.slice((current - 1) * PER_PAGE, current * PER_PAGE)

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="font-display text-title font-medium text-gray-900">{title}</h2>

      {rounds.length === 0 ? (
        <p className="font-display text-body text-gray-400">{empty}</p>
      ) : (
        <>
          {shown.map((round) => (
            <RoundRowCard
              key={round.id}
              round={round}
              canManage={canManage}
              opening={opening === round.id}
              onEdit={() => onEdit(round.id)}
            />
          ))}
          <Pagination
            page={current}
            pageCount={pageCount}
            shown={shown.length}
            total={rounds.length}
            noun={rounds.length === 1 ? 'round' : 'rounds'}
            onChange={setPage}
          />
        </>
      )}
    </Card>
  )
}

function RoundRowCard({
  round,
  canManage,
  opening,
  onEdit,
}: {
  round: RoundRow
  canManage: boolean
  opening: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [archiving, setArchiving] = useState(false)
  const status = getRoundStatus(round)
  const start = formatDate(round.openedAt)
  const end = formatDate(round.closedAt)

  async function toggleArchived() {
    setArchiving(true)
    try {
      await setRoundArchived({ data: { id: round.id, archived: !round.archivedAt } })
      router.invalidate()
    } finally {
      setArchiving(false)
    }
  }

  const archived = round.archivedAt !== null

  return (
    <div className="flex flex-col gap-4 rounded-card border border-gray-200 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={`font-display text-title font-semibold ${archived ? 'text-gray-400' : 'text-gray-900'}`}
          >
            {round.name}
          </h3>
          {/* Archived replaces the status badge rather than joining it: the status is
              read off the dates, so an archived round whose close date hasn't passed
              would advertise itself as Open when it has been withdrawn from every
              picker. Same substitution as an archived programme's round badge. */}
          {archived ? (
            <Badge className="bg-gray-100 text-gray-500">Archived</Badge>
          ) : (
            <Badge className={ROUND_STATUS_COLORS[status]}>{ROUND_STATUS_LABELS[status]}</Badge>
          )}
        </div>
        <p className={`font-display text-body ${archived ? 'text-gray-400' : 'text-gray-600'}`}>
          {start && end ? `${start} - ${end}` : (start ?? end ?? 'No dates set')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 lg:gap-x-8">
        {/* Unlike an archived programme's, these stay on an archived round. A
            programme's impact unit and themes describe how it TAKES applications, so
            they say nothing once it is retired; a round's committed spend is the record
            of what it gave away, which is most of why anyone opens Past Rounds. */}
        <Stat label="Budget" muted={archived}>
          {round.budget === null ? (
            <span className="text-gray-400">Not set</span>
          ) : (
            <>
              <span className={archived ? 'font-semibold' : 'font-semibold text-brand'}>
                {money(round.committed)} of
              </span>{' '}
              <span className="text-gray-500">{money(round.budget)}</span>
            </>
          )}
        </Stat>
        <Stat label="Programmes" muted={archived}>
          {round.programmeCount === 0 ? (
            <span className="text-gray-400">None yet</span>
          ) : (
            round.programmeCount
          )}
        </Stat>

        {canManage && (
          <ActionMenu
            label={`Actions for ${round.name}`}
            actions={[
              {
                // Editing fetches the round's programme rows first, so this one action
                // has a loading state the menu has to carry.
                label: opening ? 'Opening…' : 'Edit',
                icon: PencilEdit02Icon,
                onSelect: onEdit,
                disabled: opening,
              },
              // Archive, never delete. A round's applications and awards are the record
              // of a decision, so "we're finished with this" hides it from the pickers
              // and keeps its history — and it is reversible, which delete is not. It
              // still reads as destructive, because to everyone but us it is the thing
              // that makes a round disappear. Restore is the same act undone, so it
              // drops the red and gets the arrow-out-of-the-box glyph, since a bin on
              // the way BACK would be actively wrong.
              archived
                ? {
                    label: 'Restore',
                    icon: ArchiveRestoreIcon,
                    onSelect: toggleArchived,
                    disabled: archiving,
                  }
                : {
                    label: 'Archive',
                    icon: Delete02Icon,
                    destructive: true,
                    onSelect: toggleArchived,
                    disabled: archiving,
                  },
            ]}
          />
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  children,
  muted = false,
}: {
  label: string
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <div className="flex min-w-[120px] flex-col gap-2">
      <span className="font-display text-label font-medium text-gray-500">{label}</span>
      <span
        className={`font-display text-body font-medium ${muted ? 'text-gray-400' : 'text-gray-900'}`}
      >
        {children}
      </span>
    </div>
  )
}
