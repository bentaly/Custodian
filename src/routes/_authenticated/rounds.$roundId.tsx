import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { getRound, updateRound } from '../../server/fns/rounds'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { DateRangePicker } from '../../components/DateRangePicker'
import {
  listProgrammes,
  addProgrammeToRound,
  removeProgrammeFromRound,
} from '../../server/fns/programmes'

export const Route = createFileRoute('/_authenticated/rounds/$roundId')({
  loader: async ({ params }) => {
    const [round, clientProgrammes] = await Promise.all([
      getRound({ data: { id: params.roundId } }),
      listProgrammes(),
    ])
    return { round, clientProgrammes }
  },
  component: RoundDetail,
})


type LoadedRound = Awaited<ReturnType<typeof getRound>>
type LinkedProgramme = LoadedRound['roundProgrammes'][number]['programme']

function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return ''
  return new Date(date).toISOString().slice(0, 10)
}

function formatDate(date: Date | string | null | undefined): string | null {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function RoundDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { round, clientProgrammes } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin', 'manager'].includes(user.role)

  const [editingRound, setEditingRound] = useState(false)
  const [roundName, setRoundName] = useState(round.name)
  const [roundOpenedAt, setRoundOpenedAt] = useState(toDateInput(round.openedAt))
  const [roundClosedAt, setRoundClosedAt] = useState(toDateInput(round.closedAt))
  const [savingRound, setSavingRound] = useState(false)
  const [roundError, setRoundError] = useState('')

  const [showAddPicker, setShowAddPicker] = useState(false)
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('')
  const [addingProgramme, setAddingProgramme] = useState(false)
  const [addError, setAddError] = useState('')

  const linkedIds = new Set(round.roundProgrammes.map((rp) => rp.programmeId))
  const availableProgrammes = clientProgrammes.filter((p) => !linkedIds.has(p.id))

  async function handleSaveRound(e: React.FormEvent) {
    e.preventDefault()
    setRoundError('')
    setSavingRound(true)
    try {
      await updateRound({
        data: {
          id: round.id,
          name: roundName,
          openedAt: roundOpenedAt || undefined,
          closedAt: roundClosedAt || undefined,
        },
      })
      setEditingRound(false)
      router.invalidate()
    } catch (err) {
      setRoundError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingRound(false)
    }
  }

  async function handleAddProgramme(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProgrammeId) return
    setAddError('')
    setAddingProgramme(true)
    try {
      await addProgrammeToRound({
        data: { roundId: round.id, programmeId: selectedProgrammeId },
      })
      setShowAddPicker(false)
      setSelectedProgrammeId('')
      router.invalidate()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add programme')
    } finally {
      setAddingProgramme(false)
    }
  }

  async function handleRemoveProgramme(programmeId: string) {
    await removeProgrammeFromRound({ data: { roundId: round.id, programmeId } })
    router.invalidate()
  }

  return (
    <div className="max-w-3xl space-y-8">
      <Link
        to="/rounds"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Rounds
      </Link>

      {/* Round header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        {editingRound ? (
          <form onSubmit={handleSaveRound} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Round name</label>
              <input
                type="text"
                value={roundName}
                onChange={(e) => setRoundName(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Date range</label>
              <DateRangePicker
                startDate={roundOpenedAt}
                endDate={roundClosedAt}
                onStartChange={setRoundOpenedAt}
                onEndChange={setRoundClosedAt}
              />
            </div>
            {roundError && <p className="text-sm text-red-500">{roundError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingRound}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {savingRound ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingRound(false)
                  setRoundName(round.name)
                  setRoundOpenedAt(toDateInput(round.openedAt))
                  setRoundClosedAt(toDateInput(round.closedAt))
                  setRoundError('')
                }}
                className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-gray-900">{round.name}</h1>
                {(() => {
                  const s = getRoundStatus(round)
                  return (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROUND_STATUS_COLORS[s]}`}>
                      {ROUND_STATUS_LABELS[s]}
                    </span>
                  )
                })()}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-gray-500">
                {(round.openedAt || round.closedAt) && (
                  <span>
                    {formatDate(round.openedAt) ?? '—'} → {formatDate(round.closedAt) ?? '—'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canManage && (
                <button
                  onClick={() => setEditingRound(true)}
                  className="rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Programmes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Programmes</h2>
          <div className="flex items-center gap-2">
            {canManage && (
              <Link
                to="/programmes"
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Manage programmes →
              </Link>
            )}
            {canManage && !showAddPicker && availableProgrammes.length > 0 && (
              <button
                onClick={() => setShowAddPicker(true)}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
              >
                Add programme
              </button>
            )}
          </div>
        </div>

        {showAddPicker && (
          <form
            onSubmit={handleAddProgramme}
            className="rounded-lg border border-gray-300 bg-white p-4"
          >
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Select programme to add
            </label>
            <div className="flex items-center gap-2">
              <select
                value={selectedProgrammeId}
                onChange={(e) => setSelectedProgrammeId(e.target.value)}
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                required
                autoFocus
              >
                <option value="">Choose a programme…</option>
                {availableProgrammes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={addingProgramme}
                className="rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {addingProgramme ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddPicker(false)
                  setSelectedProgrammeId('')
                  setAddError('')
                }}
                className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
            {addError && <p className="mt-2 text-sm text-red-500">{addError}</p>}
          </form>
        )}

        {round.roundProgrammes.length === 0 && !showAddPicker ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
            <p className="text-sm text-gray-500">No programmes linked to this round.</p>
            {canManage && (
              <p className="mt-1 text-sm text-gray-400">
                <Link to="/programmes" className="underline hover:text-gray-600">
                  Create a programme
                </Link>
                {' '}then add it here.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {round.roundProgrammes.map(({ programme }) => (
              <ProgrammeCard
                key={programme.id}
                programme={programme}
                canManage={canManage}
                onRemove={() => handleRemoveProgramme(programme.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProgrammeCard({
  programme,
  canManage,
  onRemove,
}: {
  programme: LinkedProgramme
  canManage: boolean
  onRemove: () => void
}) {
  const tags = (programme.tags ?? []) as string[]

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to="/programmes/$programmeId"
              params={{ programmeId: programme.id }}
              className="text-sm font-medium text-gray-900 hover:underline"
            >
              {programme.name}
            </Link>
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {programme.goal && (
            <p className="mt-2 line-clamp-2 text-xs text-gray-400">
              {programme.goal.replace(/[#*_~`[\]]/g, '').trim()}
            </p>
          )}
        </div>
        {canManage && (
          <button
            onClick={onRemove}
            className="shrink-0 rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
