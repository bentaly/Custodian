import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { getRound, updateRound, updateRoundStatus } from '../../server/fns/rounds'
import { DateRangePicker } from '../../components/DateRangePicker'
import { createProgramme, updateProgramme, listClientTags } from '../../server/fns/programmes'
import { TagInput } from '../../components/TagInput'
import { RichTextEditor } from '../../components/RichTextEditor'

export const Route = createFileRoute('/_authenticated/rounds/$roundId')({
  loader: async ({ params }) => {
    const [round, clientTags] = await Promise.all([
      getRound({ data: { id: params.roundId } }),
      listClientTags(),
    ])
    return { round, clientTags }
  },
  component: RoundDetail,
})

const ROUND_STATUS_LABELS = {
  upcoming: 'Upcoming',
  open: 'Open',
  reviewing: 'Reviewing',
  closed: 'Closed',
}

const ROUND_STATUS_COLORS = {
  upcoming: 'bg-gray-100 text-gray-600',
  open: 'bg-green-100 text-green-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-red-100 text-red-600',
}

const PROG_STATUS_LABELS = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
}

const PROG_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-500',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

type LoadedRound = Awaited<ReturnType<typeof getRound>>
type Programme = LoadedRound['programmes'][number]

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
  const { round, clientTags } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin', 'manager'].includes(user.role)

  const [editingRound, setEditingRound] = useState(false)
  const [roundName, setRoundName] = useState(round.name)
  const [roundBudget, setRoundBudget] = useState(round.budget ?? '')
  const [roundOpenedAt, setRoundOpenedAt] = useState(toDateInput(round.openedAt))
  const [roundClosedAt, setRoundClosedAt] = useState(toDateInput(round.closedAt))
  const [savingRound, setSavingRound] = useState(false)
  const [roundError, setRoundError] = useState('')

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingProgrammeId, setEditingProgrammeId] = useState<string | null>(null)

  async function handleStatusChange(status: LoadedRound['status']) {
    await updateRoundStatus({ data: { id: round.id, status } })
    router.invalidate()
  }

  async function handleSaveRound(e: React.FormEvent) {
    e.preventDefault()
    setRoundError('')
    setSavingRound(true)
    try {
      await updateRound({
        data: {
          id: round.id,
          name: roundName,
          budget: roundBudget ? parseFloat(roundBudget.toString()) : undefined,
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
            <div className="grid grid-cols-2 gap-4">
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
                <label className="mb-1 block text-xs font-medium text-gray-500">Budget</label>
                <input
                  type="number"
                  value={roundBudget}
                  onChange={(e) => setRoundBudget(e.target.value)}
                  min="0"
                  step="1"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
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
                  setRoundBudget(round.budget ?? '')
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
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROUND_STATUS_COLORS[round.status]}`}
                >
                  {ROUND_STATUS_LABELS[round.status]}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-gray-500">
                {round.budget && (
                  <span>£{parseFloat(round.budget).toLocaleString()}</span>
                )}
                {(round.openedAt || round.closedAt) && (
                  <span>
                    {formatDate(round.openedAt) ?? '—'} → {formatDate(round.closedAt) ?? '—'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {round.status === 'upcoming' && canManage && (
                <button
                  onClick={() => handleStatusChange('open')}
                  className="rounded border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50"
                >
                  Open round
                </button>
              )}
              {round.status === 'open' && canManage && (
                <button
                  onClick={() => handleStatusChange('reviewing')}
                  className="rounded border border-yellow-200 px-3 py-1.5 text-xs font-medium text-yellow-700 hover:bg-yellow-50"
                >
                  Move to review
                </button>
              )}
              {round.status === 'reviewing' && canManage && (
                <button
                  onClick={() => handleStatusChange('closed')}
                  className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Close round
                </button>
              )}
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
          {canManage && !showCreateForm && (
            <button
              onClick={() => {
                setShowCreateForm(true)
                setEditingProgrammeId(null)
              }}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
            >
              Add programme
            </button>
          )}
        </div>

        {showCreateForm && (
          <ProgrammeForm
            roundId={round.id}
            clientTags={clientTags}
            onSave={() => {
              setShowCreateForm(false)
              router.invalidate()
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {round.programmes.length === 0 && !showCreateForm ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
            <p className="text-sm text-gray-500">No programmes yet.</p>
            {canManage && (
              <p className="mt-1 text-sm text-gray-400">
                Add a programme to start accepting applications.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {round.programmes.map((programme) =>
              editingProgrammeId === programme.id ? (
                <ProgrammeForm
                  key={programme.id}
                  programme={programme}
                  roundId={round.id}
                  clientTags={clientTags}
                  onSave={() => {
                    setEditingProgrammeId(null)
                    router.invalidate()
                  }}
                  onCancel={() => setEditingProgrammeId(null)}
                />
              ) : (
                <ProgrammeCard
                  key={programme.id}
                  programme={programme}
                  canManage={canManage}
                  onEdit={() => {
                    setEditingProgrammeId(programme.id)
                    setShowCreateForm(false)
                  }}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ProgrammeCard({
  programme,
  canManage,
  onEdit,
}: {
  programme: Programme
  canManage: boolean
  onEdit: () => void
}) {
  const tags = (programme.tags ?? []) as string[]

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{programme.name}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROG_STATUS_COLORS[programme.status]}`}
            >
              {PROG_STATUS_LABELS[programme.status]}
            </span>
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
            onClick={onEdit}
            className="shrink-0 rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  )
}

function ProgrammeForm({
  roundId,
  programme,
  clientTags,
  onSave,
  onCancel,
}: {
  roundId: string
  programme?: Programme
  clientTags: string[]
  onSave: () => void
  onCancel: () => void
}) {
  const isEdit = !!programme
  const [name, setName] = useState(programme?.name ?? '')
  const [description, setDescription] = useState(programme?.description ?? '')
  const [goal, setGoal] = useState(programme?.goal ?? '')
  const [tags, setTags] = useState<string[]>((programme?.tags ?? []) as string[])
  const [status, setStatus] = useState<'draft' | 'active' | 'closed'>(
    programme?.status ?? 'draft',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (isEdit) {
        await updateProgramme({
          data: {
            id: programme.id,
            name,
            description: description || undefined,
            goal: goal || undefined,
            tags,
            status,
          },
        })
      } else {
        await createProgramme({
          data: {
            roundId,
            name,
            description: description || undefined,
            goal: goal || undefined,
            tags,
          },
        })
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-5">
      <h3 className="mb-4 text-sm font-medium text-gray-700">
        {isEdit ? 'Edit programme' : 'New programme'}
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
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
          {isEdit && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          )}
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
          <RichTextEditor
            key={programme?.id ?? 'create'}
            defaultValue={goal}
            onChange={setGoal}
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add programme'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
