import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { listMyRounds, createRound } from '../../server/fns/rounds'
import { DateRangePicker } from '../../components/DateRangePicker'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { Badge, Button, Card, EmptyState, Input, Label } from '../../components/ui'

export const Route = createFileRoute('/_authenticated/rounds/')({
  loader: () => listMyRounds(),
  component: Rounds,
})

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
          openedAt,
          closedAt,
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
          <Button onClick={() => setShowCreate(!showCreate)}>New round</Button>
        )}
      </div>

      {showCreate && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-gray-700">Create funding round</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>Round name</Label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Spring Grants 2025"
                required
                autoFocus
              />
            </div>
            <div>
              <Label>Date range</Label>
              <DateRangePicker
                startDate={openedAt}
                endDate={closedAt}
                onStartChange={setOpenedAt}
                onEndChange={setClosedAt}
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create round'}
              </Button>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {rounds.length === 0 && !showCreate ? (
        <EmptyState>
          <p className="text-sm text-gray-500">No funding rounds yet.</p>
          {canManage && (
            <p className="mt-1 text-sm text-gray-400">Create your first round to get started.</p>
          )}
        </EmptyState>
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
                      {(() => {
                        const s = getRoundStatus(round)
                        return (
                          <Badge className={ROUND_STATUS_COLORS[s]}>{ROUND_STATUS_LABELS[s]}</Badge>
                        )
                      })()}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                      <span>
                        {round.roundProgrammes.length}{' '}
                        {round.roundProgrammes.length === 1 ? 'programme' : 'programmes'}
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
