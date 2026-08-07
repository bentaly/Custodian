import { useState } from 'react'
import { orNotFound } from '../../lib/loader'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  getProgramme,
  updateProgramme,
  deleteProgramme,
  setProgrammeArchived,
  listClientTags,
  addProgrammeToRound,
  removeProgrammeFromRound,
} from '../../server/fns/programmes'
import { listMyRounds } from '../../server/fns/rounds'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { GrantTermsFields } from '../../components/GrantTermsFields'
import { TagInput } from '../../components/TagInput'
import { RichTextEditor } from '../../components/RichTextEditor'
import { IMPACT_UNITS, DEFAULT_IMPACT_UNIT, impactUnitLabel } from '../../lib/impactUnits'
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Select,
  Textarea,
} from '../../components/ui'

export const Route = createFileRoute('/_authenticated/programmes/$programmeId')({
  loader: async ({ params }) => {
    const [programme, clientTags, allRounds] = await Promise.all([
      orNotFound(getProgramme({ data: { id: params.programmeId } })),
      listClientTags(),
      listMyRounds(),
    ])
    return { programme, clientTags, allRounds }
  },
  component: ProgrammeDetail,
})

type LoadedProgramme = Awaited<ReturnType<typeof getProgramme>>
type RoundProgrammeRow = LoadedProgramme['roundProgrammes'][number]
type MyRound = Awaited<ReturnType<typeof listMyRounds>>[number]

function ProgrammeDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { programme, clientTags, allRounds } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(programme.name)
  const [description, setDescription] = useState(programme.description ?? '')
  const [goal, setGoal] = useState(programme.goal ?? '')
  const [tags, setTags] = useState<string[]>((programme.tags ?? []) as string[])
  const [impactUnit, setImpactUnit] = useState(programme.impactUnit ?? DEFAULT_IMPACT_UNIT)
  const [impactUnitCustom, setImpactUnitCustom] = useState(programme.impactUnitLabel ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [archiving, setArchiving] = useState(false)

  const [showAddRound, setShowAddRound] = useState(false)
  const [selectedRoundId, setSelectedRoundId] = useState('')
  const [addBudget, setAddBudget] = useState('')
  const [addMaxGrantAmount, setAddMaxGrantAmount] = useState('')
  const [addGrantDurationYears, setAddGrantDurationYears] = useState('')
  const [addingRound, setAddingRound] = useState(false)
  const [addRoundError, setAddRoundError] = useState('')

  const linkedRoundIds = new Set(
    programme.roundProgrammes.map((rp: RoundProgrammeRow) => rp.roundId),
  )
  const availableRounds = allRounds.filter((r: MyRound) => !linkedRoundIds.has(r.id))

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
          impactUnit,
          impactUnitLabel: impactUnit === 'other' ? impactUnitCustom.trim() || null : null,
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
      await addProgrammeToRound({
        data: {
          roundId: selectedRoundId,
          programmeId: programme.id,
          budget: parseFloat(addBudget),
          maxGrantAmount: addMaxGrantAmount ? parseFloat(addMaxGrantAmount) : undefined,
          grantDurationYears: addGrantDurationYears
            ? parseInt(addGrantDurationYears, 10)
            : undefined,
        },
      })
      setShowAddRound(false)
      setSelectedRoundId('')
      setAddBudget('')
      setAddMaxGrantAmount('')
      setAddGrantDurationYears('')
      router.invalidate()
    } catch (err) {
      setAddRoundError(err instanceof Error ? err.message : 'Failed to add to round')
    } finally {
      setAddingRound(false)
    }
  }

  async function handleArchive(archived: boolean) {
    setArchiving(true)
    try {
      await setProgrammeArchived({ data: { id: programme.id, archived } })
      router.invalidate()
    } finally {
      setArchiving(false)
    }
  }

  async function handleDelete() {
    setDeleteError('')
    setDeleting(true)
    try {
      await deleteProgramme({ data: { id: programme.id } })
      router.navigate({ to: '/programmes' })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete programme')
      setDeleting(false)
    }
  }

  const [removingRoundId, setRemovingRoundId] = useState<string | null>(null)
  async function handleRemoveFromRound(roundId: string) {
    setRemovingRoundId(roundId)
    try {
      await removeProgrammeFromRound({ data: { roundId, programmeId: programme.id } })
      router.invalidate()
    } finally {
      setRemovingRoundId(null)
    }
  }

  const tags_ = (programme.tags ?? []) as string[]

  return (
    <div className="max-w-3xl space-y-8">
      <Breadcrumb
        items={[
          { label: 'Settings', to: '/settings' },
          { label: 'Programmes', to: '/programmes' },
          { label: programme.name },
        ]}
      />

      {/* Programme header */}
      <Card className="p-5">
        {editing ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Label>
                Description <span className="text-gray-400">(optional)</span>
              </Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            <div>
              <Label>Themes</Label>
              <TagInput value={tags} onChange={setTags} suggestions={clientTags} />
            </div>
            <div>
              <Label>
                Impact measured in{' '}
                <span className="font-normal text-gray-400">
                  — used to count what this programme's grants achieve
                </span>
              </Label>
              <div className="flex gap-2">
                <Select value={impactUnit} onChange={(e) => setImpactUnit(e.target.value)}>
                  {IMPACT_UNITS.map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.label}
                    </option>
                  ))}
                </Select>
                {impactUnit === 'other' ? (
                  <Input
                    type="text"
                    value={impactUnitCustom}
                    onChange={(e) => setImpactUnitCustom(e.target.value)}
                    placeholder="e.g. hectares of peatland restored"
                    className="flex-1"
                    required
                  />
                ) : (
                  <span className="self-center text-xs text-gray-400">
                    {IMPACT_UNITS.find((u) => u.key === impactUnit)?.hint}
                  </span>
                )}
              </div>
              {impactUnit === 'other' && (
                <p className="mt-1 text-xs text-gray-400">
                  Use a plural phrase that reads as "number of…" — it appears on Insights and guides
                  how grant reports are read.
                </p>
              )}
            </div>
            <div>
              <Label>
                Programme priorities{' '}
                <span className="font-normal text-gray-400">
                  — used by AI to score applications
                </span>
              </Label>
              <RichTextEditor key={programme.id} defaultValue={goal} onChange={setGoal} />
            </div>

            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setName(programme.name)
                  setDescription(programme.description ?? '')
                  setGoal(programme.goal ?? '')
                  setTags((programme.tags ?? []) as string[])
                  setImpactUnit(programme.impactUnit ?? DEFAULT_IMPACT_UNIT)
                  setImpactUnitCustom(programme.impactUnitLabel ?? '')
                  setSaveError('')
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
                <h1 className="text-xl font-semibold text-gray-900">{programme.name}</h1>
                {programme.archivedAt && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                    Archived
                  </span>
                )}
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
              <p className="mt-2 text-xs text-gray-400">
                Impact measured in{' '}
                <span className="font-medium text-gray-500">
                  {impactUnitLabel(programme.impactUnit, programme.impactUnitLabel).toLowerCase()}
                </span>
              </p>
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" size="xs" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => handleArchive(!programme.archivedAt)}
                  disabled={archiving}
                >
                  {archiving ? '…' : programme.archivedAt ? 'Restore' : 'Archive'}
                </Button>
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
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Rounds */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Rounds</h2>
          {canManage && !showAddRound && availableRounds.length > 0 && (
            <Button size="sm" onClick={() => setShowAddRound(true)}>
              Add to round
            </Button>
          )}
        </div>

        {showAddRound && (
          <form
            onSubmit={handleAddToRound}
            className="rounded-lg border border-gray-300 bg-white p-4 space-y-4"
          >
            <div>
              <Label>Round</Label>
              <Select
                value={selectedRoundId}
                onChange={(e) => setSelectedRoundId(e.target.value)}
                required
              >
                <option value="">Choose a round…</option>
                {availableRounds.map((r: MyRound) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
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
            {addRoundError && <p className="text-sm text-red-500">{addRoundError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addingRound}>
                {addingRound ? 'Adding…' : 'Add to round'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowAddRound(false)
                  setSelectedRoundId('')
                  setAddBudget('')
                  setAddMaxGrantAmount('')
                  setAddGrantDurationYears('')
                  setAddRoundError('')
                }}
              >
                Cancel
              </Button>
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
            {programme.roundProgrammes.map(({ round }: RoundProgrammeRow) => (
              <Card key={round.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <Link
                    to="/rounds/$roundId"
                    params={{ roundId: round.id }}
                    className="text-sm font-medium text-gray-900 hover:underline"
                  >
                    {round.name}
                  </Link>
                  <Badge className={ROUND_STATUS_COLORS[getRoundStatus(round)]}>
                    {ROUND_STATUS_LABELS[getRoundStatus(round)]}
                  </Badge>
                </div>
                {canManage && (
                  <Button
                    variant="dangerGhost"
                    size="xs"
                    onClick={() => handleRemoveFromRound(round.id)}
                    disabled={removingRoundId === round.id}
                  >
                    {removingRoundId === round.id ? 'Removing…' : 'Remove'}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete programme"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        confirmLabel="Delete programme"
        busyLabel="Deleting…"
        busy={deleting}
        error={deleteError}
      >
        Delete <span className="font-medium text-gray-700">{programme.name}</span>?
        {programme.roundProgrammes.length > 0 && (
          <>
            {' '}
            It is in {programme.roundProgrammes.length} round
            {programme.roundProgrammes.length === 1 ? '' : 's'}, and their budgets go with it.
          </>
        )}{' '}
        This cannot be undone — archive it instead if any of it is worth keeping.
      </ConfirmDialog>
    </div>
  )
}
