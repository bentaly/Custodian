import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  getProgramme,
  updateProgramme,
  listClientTags,
  addProgrammeToRound,
  removeProgrammeFromRound,
} from '../../server/fns/programmes'
import { listMyRounds } from '../../server/fns/rounds'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { TagInput } from '../../components/TagInput'
import { RichTextEditor } from '../../components/RichTextEditor'

export const Route = createFileRoute('/_authenticated/programmes/$programmeId')({
  loader: async ({ params }) => {
    const [programme, clientTags, allRounds] = await Promise.all([
      getProgramme({ data: { id: params.programmeId } }),
      listClientTags(),
      listMyRounds(),
    ])
    return { programme, clientTags, allRounds }
  },
  component: ProgrammeDetail,
})


type LoadedProgramme = Awaited<ReturnType<typeof getProgramme>>

function ProgrammeDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { programme, clientTags, allRounds } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin', 'manager'].includes(user.role)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(programme.name)
  const [description, setDescription] = useState(programme.description ?? '')
  const [goal, setGoal] = useState(programme.goal ?? '')
  const [tags, setTags] = useState<string[]>((programme.tags ?? []) as string[])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [showAddRound, setShowAddRound] = useState(false)
  const [selectedRoundId, setSelectedRoundId] = useState('')
  const [addingRound, setAddingRound] = useState(false)
  const [addRoundError, setAddRoundError] = useState('')

  const linkedRoundIds = new Set(programme.roundProgrammes.map((rp) => rp.roundId))
  const availableRounds = allRounds.filter((r) => !linkedRoundIds.has(r.id))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaving(true)
    try {
      await updateProgramme({
        data: {
          id: programme.id,
          name,
          description: description || undefined,
          goal: goal || undefined,
          tags,
        },
      })
      setEditing(false)
      router.invalidate()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddToRound(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRoundId) return
    setAddRoundError('')
    setAddingRound(true)
    try {
      await addProgrammeToRound({ data: { roundId: selectedRoundId, programmeId: programme.id } })
      setShowAddRound(false)
      setSelectedRoundId('')
      router.invalidate()
    } catch (err) {
      setAddRoundError(err instanceof Error ? err.message : 'Failed to add to round')
    } finally {
      setAddingRound(false)
    }
  }

  async function handleRemoveFromRound(roundId: string) {
    await removeProgrammeFromRound({ data: { roundId, programmeId: programme.id } })
    router.invalidate()
  }

  const tags_ = (programme.tags ?? []) as string[]

  return (
    <div className="max-w-3xl space-y-8">
      <Link
        to="/programmes"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Programmes
      </Link>

      {/* Programme header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        {editing ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Themes</label>
              <TagInput value={tags} onChange={setTags} suggestions={clientTags} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Goal{' '}
                <span className="font-normal text-gray-400">— used by AI to score applications</span>
              </label>
              <RichTextEditor key={programme.id} defaultValue={goal} onChange={setGoal} />
            </div>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setName(programme.name)
                  setDescription(programme.description ?? '')
                  setGoal(programme.goal ?? '')
                  setTags((programme.tags ?? []) as string[])
                  setSaveError('')
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
                <h1 className="text-xl font-semibold text-gray-900">{programme.name}</h1>
              </div>
              {programme.description && (
                <p className="mt-1 text-sm text-gray-500">{programme.description}</p>
              )}
              {tags_.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags_.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {canManage && (
              <button
                onClick={() => setEditing(true)}
                className="shrink-0 rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Rounds */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Rounds</h2>
          {canManage && !showAddRound && availableRounds.length > 0 && (
            <button
              onClick={() => setShowAddRound(true)}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
            >
              Add to round
            </button>
          )}
        </div>

        {showAddRound && (
          <form
            onSubmit={handleAddToRound}
            className="rounded-lg border border-gray-300 bg-white p-4 space-y-3"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Round</label>
              <select
                value={selectedRoundId}
                onChange={(e) => setSelectedRoundId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                required
              >
                <option value="">Choose a round…</option>
                {availableRounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {addRoundError && <p className="text-sm text-red-500">{addRoundError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={addingRound}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {addingRound ? 'Adding…' : 'Add to round'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddRound(false)
                  setSelectedRoundId('')
                  setAddRoundError('')
                }}
                className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {programme.roundProgrammes.length === 0 && !showAddRound ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-8 text-center">
            <p className="text-sm text-gray-500">Not in any round.</p>
            {canManage && availableRounds.length > 0 && (
              <p className="mt-1 text-sm text-gray-400">
                Add this programme to a round to start accepting applications.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {programme.roundProgrammes.map(({ round }) => (
              <div
                key={round.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Link
                    to="/rounds/$roundId"
                    params={{ roundId: round.id }}
                    className="text-sm font-medium text-gray-900 hover:underline"
                  >
                    {round.name}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROUND_STATUS_COLORS[getRoundStatus(round)]}`}
                  >
                    {ROUND_STATUS_LABELS[getRoundStatus(round)]}
                  </span>
                </div>
                {canManage && (
                  <button
                    onClick={() => handleRemoveFromRound(round.id)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
