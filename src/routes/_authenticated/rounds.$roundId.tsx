import { useState } from 'react'
import { orNotFound } from '../../lib/loader'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { getRound, updateRound, deleteRound, setRoundArchived } from '../../server/fns/rounds'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { DateRangePicker } from '../../components/DateRangePicker'
import {
  listProgrammes,
  addProgrammeToRound,
  updateRoundProgramme,
  removeProgrammeFromRound,
} from '../../server/fns/programmes'
import { GrantTermsFields } from '../../components/GrantTermsFields'
import { Breadcrumb, Button, Card, ConfirmDialog, Input, Label, Select } from '../../components/ui'

export const Route = createFileRoute('/_authenticated/rounds/$roundId')({
  loader: async ({ params }) => {
    const [round, clientProgrammes] = await Promise.all([
      orNotFound(getRound({ data: { id: params.roundId } })),
      listProgrammes(),
    ])
    return { round, clientProgrammes }
  },
  component: RoundDetail,
})

type LoadedRound = Awaited<ReturnType<typeof getRound>>
type RoundProgrammeRow = LoadedRound['roundProgrammes'][number]
type LinkedProgramme = RoundProgrammeRow['programme']

function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return ''
  return new Date(date).toISOString().slice(0, 10)
}

function formatDate(date: Date | string | null | undefined): string | null {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function RoundDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { round, clientProgrammes } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin'].includes(user.role)
  const canDelete = ['superadmin', 'admin'].includes(user.role)

  const [editingRound, setEditingRound] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingRound, setDeletingRound] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [roundName, setRoundName] = useState(round.name)
  const [roundOpenedAt, setRoundOpenedAt] = useState(toDateInput(round.openedAt))
  const [roundClosedAt, setRoundClosedAt] = useState(toDateInput(round.closedAt))
  const [savingRound, setSavingRound] = useState(false)
  const [roundError, setRoundError] = useState('')

  const [showAddPicker, setShowAddPicker] = useState(false)
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('')
  const [addBudget, setAddBudget] = useState('')
  const [addMaxGrantAmount, setAddMaxGrantAmount] = useState('')
  const [addGrantDurationYears, setAddGrantDurationYears] = useState('')
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
        data: {
          roundId: round.id,
          programmeId: selectedProgrammeId,
          budget: parseFloat(addBudget),
          maxGrantAmount: addMaxGrantAmount ? parseFloat(addMaxGrantAmount) : undefined,
          grantDurationYears: addGrantDurationYears
            ? parseInt(addGrantDurationYears, 10)
            : undefined,
        },
      })
      setShowAddPicker(false)
      setSelectedProgrammeId('')
      setAddBudget('')
      setAddMaxGrantAmount('')
      setAddGrantDurationYears('')
      router.invalidate()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add programme')
    } finally {
      setAddingProgramme(false)
    }
  }

  const [removingProgrammeId, setRemovingProgrammeId] = useState<string | null>(null)
  async function handleRemoveProgramme(programmeId: string) {
    setRemovingProgrammeId(programmeId)
    try {
      await removeProgrammeFromRound({ data: { roundId: round.id, programmeId } })
      router.invalidate()
    } finally {
      setRemovingProgrammeId(null)
    }
  }

  async function handleArchive(archived: boolean) {
    setArchiving(true)
    try {
      await setRoundArchived({ data: { id: round.id, archived } })
      router.invalidate()
    } finally {
      setArchiving(false)
    }
  }

  async function handleDeleteRound() {
    setDeleteError('')
    setDeletingRound(true)
    try {
      await deleteRound({ data: { id: round.id } })
      router.navigate({ to: '/rounds' })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete round')
      setDeletingRound(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <Breadcrumb
        items={[
          { label: 'Settings', to: '/settings' },
          { label: 'Rounds', to: '/rounds' },
          { label: round.name },
        ]}
      />

      {/* Round header */}
      <Card className="p-4">
        {editingRound ? (
          <form onSubmit={handleSaveRound} className="space-y-4">
            <div>
              <Label>Round name</Label>
              <Input
                type="text"
                value={roundName}
                onChange={(e) => setRoundName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Label>Date range</Label>
              <DateRangePicker
                startDate={roundOpenedAt}
                endDate={roundClosedAt}
                onStartChange={setRoundOpenedAt}
                onEndChange={setRoundClosedAt}
                required
              />
            </div>
            {roundError && <p className="text-body text-danger">{roundError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={savingRound}>
                {savingRound ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingRound(false)
                  setRoundName(round.name)
                  setRoundOpenedAt(toDateInput(round.openedAt))
                  setRoundClosedAt(toDateInput(round.closedAt))
                  setRoundError('')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-heading font-semibold text-gray-900">{round.name}</h1>
                {(() => {
                  const s = getRoundStatus(round)
                  return (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-label font-medium ${ROUND_STATUS_COLORS[s]}`}
                    >
                      {ROUND_STATUS_LABELS[s]}
                    </span>
                  )
                })()}
                {round.archivedAt && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-label font-medium text-gray-500">
                    Archived
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-body text-gray-500">
                {(round.openedAt || round.closedAt) && (
                  <span>
                    {formatDate(round.openedAt) ?? '—'} → {formatDate(round.closedAt) ?? '—'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canManage && (
                <Button variant="secondary" size="xs" onClick={() => setEditingRound(true)}>
                  Edit
                </Button>
              )}
              {canManage && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => handleArchive(!round.archivedAt)}
                  disabled={archiving}
                >
                  {archiving ? '…' : round.archivedAt ? 'Restore' : 'Archive'}
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="dangerGhost"
                  size="xs"
                  onClick={() => {
                    setDeleteError('')
                    setConfirmingDelete(true)
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Programmes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-semibold text-gray-700">Programmes</h2>
          <div className="flex items-center gap-2">
            {canManage && (
              <Link to="/programmes" className="text-label text-gray-500 hover:text-gray-700">
                Manage programmes →
              </Link>
            )}
            {canManage && !showAddPicker && availableProgrammes.length > 0 && (
              <Button size="sm" onClick={() => setShowAddPicker(true)}>
                Add programme
              </Button>
            )}
          </div>
        </div>

        {showAddPicker && (
          <form
            onSubmit={handleAddProgramme}
            className="rounded-card border border-gray-300 bg-white p-4 space-y-4"
          >
            <div>
              <Label>Programme</Label>
              <Select
                value={selectedProgrammeId}
                onChange={(e) => setSelectedProgrammeId(e.target.value)}
                required
                autoFocus
              >
                <option value="">Choose a programme…</option>
                {availableProgrammes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <GrantTermsFields
              budget={addBudget}
              onBudget={setAddBudget}
              maxGrantAmount={addMaxGrantAmount}
              onMaxGrantAmount={setAddMaxGrantAmount}
              grantDurationYears={addGrantDurationYears}
              onGrantDurationYears={setAddGrantDurationYears}
              budgetRequired
            />
            {addError && <p className="text-body text-danger">{addError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addingProgramme}>
                {addingProgramme ? 'Adding…' : 'Add programme'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowAddPicker(false)
                  setSelectedProgrammeId('')
                  setAddBudget('')
                  setAddMaxGrantAmount('')
                  setAddGrantDurationYears('')
                  setAddError('')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {round.roundProgrammes.length === 0 && !showAddPicker ? (
          <div className="rounded-chip border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
            <p className="text-body text-gray-500">No programmes linked to this round.</p>
            {canManage && (
              <p className="mt-1 text-body text-gray-400">
                <Link to="/programmes" className="underline hover:text-gray-600">
                  Create a programme
                </Link>{' '}
                then add it here.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {round.roundProgrammes.map((rp) => (
              <ProgrammeCard
                key={rp.programme.id}
                programme={rp.programme}
                roundProgramme={rp}
                canManage={canManage}
                removing={removingProgrammeId === rp.programme.id}
                onRemove={() => handleRemoveProgramme(rp.programme.id)}
                onSaved={() => router.invalidate()}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete round"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={handleDeleteRound}
        confirmLabel="Delete round"
        busyLabel="Deleting…"
        busy={deletingRound}
        error={deleteError}
      >
        Delete <span className="font-medium text-gray-700">{round.name}</span>? This also removes
        its linked programmes from the round, and cannot be undone. If the round has any history
        worth keeping, archive it instead.
      </ConfirmDialog>
    </div>
  )
}

function ProgrammeCard({
  programme,
  roundProgramme,
  canManage,
  removing,
  onRemove,
  onSaved,
}: {
  programme: LinkedProgramme
  roundProgramme: RoundProgrammeRow
  canManage: boolean
  removing: boolean
  onRemove: () => void
  onSaved: () => void
}) {
  const tags = (programme.tags ?? []) as string[]
  const budget = parseFloat(roundProgramme.budget)
  const maxGrant = roundProgramme.maxGrantAmount ? parseFloat(roundProgramme.maxGrantAmount) : null
  const duration = roundProgramme.grantDurationYears ?? null

  const [editing, setEditing] = useState(false)
  const [editBudget, setEditBudget] = useState(roundProgramme.budget)
  const [editMaxGrantAmount, setEditMaxGrantAmount] = useState(roundProgramme.maxGrantAmount ?? '')
  const [editGrantDurationYears, setEditGrantDurationYears] = useState(
    roundProgramme.grantDurationYears?.toString() ?? '',
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaving(true)
    try {
      await updateRoundProgramme({
        data: {
          id: roundProgramme.id,
          budget: parseFloat(editBudget),
          maxGrantAmount: editMaxGrantAmount ? parseFloat(editMaxGrantAmount) : undefined,
          grantDurationYears: editGrantDurationYears
            ? parseInt(editGrantDurationYears, 10)
            : undefined,
        },
      })
      setEditing(false)
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="px-5 py-4">
      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-body font-medium text-gray-700">{programme.name}</p>
          <GrantTermsFields
            budget={editBudget}
            onBudget={setEditBudget}
            maxGrantAmount={editMaxGrantAmount}
            onMaxGrantAmount={setEditMaxGrantAmount}
            grantDurationYears={editGrantDurationYears}
            onGrantDurationYears={setEditGrantDurationYears}
            budgetRequired
          />
          {saveError && <p className="text-body text-danger">{saveError}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(false)
                setEditBudget(roundProgramme.budget)
                setEditMaxGrantAmount(roundProgramme.maxGrantAmount ?? '')
                setEditGrantDurationYears(roundProgramme.grantDurationYears?.toString() ?? '')
                setSaveError('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              to="/programmes/$programmeId"
              params={{ programmeId: programme.id }}
              className="text-body font-medium text-gray-900 hover:underline"
            >
              {programme.name}
            </Link>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-label text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {programme.goal && (
              <p className="mt-2 line-clamp-2 text-label text-gray-400">
                {programme.goal.replace(/[#*_~`[\]]/g, '').trim()}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-3">
              <div>
                <span className="text-label text-gray-400">Budget </span>
                <span className="text-label font-medium text-gray-700">
                  £{budget.toLocaleString()}
                </span>
              </div>
              {maxGrant !== null && (
                <div>
                  <span className="text-label text-gray-400">Max award </span>
                  <span className="text-label font-medium text-gray-700">
                    £{maxGrant.toLocaleString()}
                  </span>
                </div>
              )}
              {duration !== null && (
                <div>
                  <span className="text-label text-gray-400">Duration </span>
                  <span className="text-label font-medium text-gray-700">
                    {duration} {duration === 1 ? 'yr' : 'yrs'}
                  </span>
                  {maxGrant !== null && duration > 1 && (
                    <span className="text-label text-gray-400">
                      {' '}
                      (£{(maxGrant / duration).toLocaleString()}/yr)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="xs" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="dangerGhost" size="xs" onClick={onRemove} disabled={removing}>
                {removing ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
