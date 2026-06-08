import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { listMyRounds, createRound } from '../../server/fns/rounds'
import { DateRangePicker } from '../../components/DateRangePicker'

export const Route = createFileRoute('/_authenticated/rounds/')({
  loader: () => listMyRounds(),
  component: Rounds,
})

const STATUS_LABELS: Record<string, string> = {
  upcoming: 'Upcoming',
  open: 'Open',
  reviewing: 'Reviewing',
  closed: 'Closed',
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'bg-gray-100 text-gray-600',
  open: 'bg-green-100 text-green-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-red-100 text-red-600',
}

function formatDate(date: Date | string | null | undefined) {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Rounds() {
  const router = useRouter()
  const rounds = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const canManage = ['superadmin', 'admin', 'manager'].includes(user.role)

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [openedAt, setOpenedAt] = useState('')
  const [closedAt, setClosedAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!user.clientId) return
    setError('')
    setCreating(true)
    try {
      const round = await createRound({
        data: {
          clientId: user.clientId,
          name,
          budget: budget ? parseFloat(budget) : undefined,
          openedAt: openedAt || undefined,
          closedAt: closedAt || undefined,
        },
      })
      router.navigate({ to: '/rounds/$roundId', params: { roundId: round.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create round')
      setCreating(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Funding Rounds</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your organisation's funding rounds and programmes
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            New round
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-medium text-gray-700">Create funding round</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Round name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Spring Grants 2025"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Budget <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="1"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Date range <span className="text-gray-400">(optional)</span>
              </label>
              <DateRangePicker
                startDate={openedAt}
                endDate={closedAt}
                onStartChange={setOpenedAt}
                onEndChange={setClosedAt}
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create round'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {rounds.length === 0 && !showCreate ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-gray-500">No funding rounds yet.</p>
          {canManage && (
            <p className="mt-1 text-sm text-gray-400">Create your first round to get started.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rounds.map((round) => {
            const start = formatDate(round.openedAt)
            const end = formatDate(round.closedAt)
            return (
              <Link
                key={round.id}
                to="/rounds/$roundId"
                params={{ roundId: round.id }}
                className="block rounded-lg border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{round.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[round.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {STATUS_LABELS[round.status] ?? round.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                      {round.budget && (
                        <span>£{parseFloat(round.budget).toLocaleString()}</span>
                      )}
                      <span>
                        {round.programmes.length}{' '}
                        {round.programmes.length === 1 ? 'programme' : 'programmes'}
                      </span>
                      {(start || end) && (
                        <span>
                          {start ?? '—'} → {end ?? '—'}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">→</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
