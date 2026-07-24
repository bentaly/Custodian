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
import { IMPACT_UNITS, DEFAULT_IMPACT_UNIT, impactUnitLabel } from '../../lib/impactUnits'
import { Badge, Button, Card, Input, Label, Textarea } from '../../components/ui'

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
type RoundProgrammeRow = LoadedProgramme['roundProgrammes'][number]
type MyRound = Awaited<ReturnType<typeof listMyRounds>>[number]

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
  const [impactUnit, setImpactUnit] = useState(programme.impactUnit ?? DEFAULT_IMPACT_UNIT)
  const [impactUnitCustom, setImpactUnitCustom] = useState(programme.impactUnitLabel ?? '')
  const [targetBeneficiaries, setTargetBeneficiaries] = useState(programme.targetBeneficiaries?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [showAddRound, setShowAddRound] = useState(false)
  const [selectedRoundId, setSelectedRoundId] = useState('')
  const [addBudget, setAddBudget] = useState('')
  const [addMaxGrantAmount, setAddMaxGrantAmount] = useState('')
  const [addGrantDurationYears, setAddGrantDurationYears] = useState('')
  const [addingRound, setAddingRound] = useState(false)
  const [addRoundError, setAddRoundError] = useState('')

  const linkedRoundIds = new Set(programme.roundProgrammes.map((rp: RoundProgrammeRow) => rp.roundId))
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
          targetBeneficiaries: targetBeneficiaries.trim() ? parseInt(targetBeneficiaries, 10) : null,
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
          grantDurationYears: addGrantDurationYears ? parseInt(addGrantDurationYears, 10) : undefined,
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
                <select
                  value={impactUnit}
                  onChange={(e) => setImpactUnit(e.target.value)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {IMPACT_UNITS.map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.label}
                    </option>
                  ))}
                </select>
                {impactUnit === 'other' ? (
                  <input
                    type="text"
                    value={impactUnitCustom}
                    onChange={(e) => setImpactUnitCustom(e.target.value)}
                    placeholder="e.g. hectares of peatland restored"
                    className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
                Typical beneficiaries per grant{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={targetBeneficiaries}
                  onChange={(e) => setTargetBeneficiaries(e.target.value)}
                  placeholder="e.g. 340"
                  className="w-40"
                />
                <span className="text-xs text-gray-400">
                  {impactUnitLabel(impactUnit, impactUnitCustom).toLowerCase()} — sets the beneficiary and
                  cost-per-beneficiary figures on each application
                </span>
              </div>
            </div>
            <div>
              <Label>
                Programme priorities{' '}
                <span className="font-normal text-gray-400">— used by AI to score applications</span>
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
                  setTargetBeneficiaries(programme.targetBeneficiaries?.toString() ?? '')
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
                {programme.targetBeneficiaries != null && (
                  <>
                    {' · '}
                    <span className="font-medium text-gray-500">
                      ~{programme.targetBeneficiaries.toLocaleString('en-GB')}
                    </span>{' '}
                    per grant
                  </>
                )}
              </p>
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
              <select
                value={selectedRoundId}
                onChange={(e) => setSelectedRoundId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                required
              >
                <option value="">Choose a round…</option>
                {availableRounds.map((r: MyRound) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Total budget</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">£</span>
                  <input
                    type="number"
                    value={addBudget}
                    onChange={(e) => setAddBudget(e.target.value)}
                    min="0"
                    step="1"
                    placeholder="0"
                    className="w-full rounded border border-gray-300 py-2 pl-6 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </div>
              </div>
              <div>
                <Label>Max per award</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">£</span>
                  <input
                    type="number"
                    value={addMaxGrantAmount}
                    onChange={(e) => setAddMaxGrantAmount(e.target.value)}
                    min="0"
                    step="1"
                    placeholder="0"
                    className="w-full rounded border border-gray-300 py-2 pl-6 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </div>
              </div>
              <div>
                <Label>Duration</Label>
                <div className="relative">
                  <input
                    type="number"
                    value={addGrantDurationYears}
                    onChange={(e) => setAddGrantDurationYears(e.target.value)}
                    min="1"
                    max="20"
                    step="1"
                    placeholder="1"
                    className="w-full rounded border border-gray-300 py-2 pl-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">yrs</span>
                </div>
              </div>
            </div>
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
              <Card
                key={round.id}
                className="flex items-center justify-between px-4 py-3"
              >
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
                  <button
                    onClick={() => handleRemoveFromRound(round.id)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    Remove
                  </button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
