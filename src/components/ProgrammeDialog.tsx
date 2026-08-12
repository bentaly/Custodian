import { useState } from 'react'
import { saveProgramme } from '../server/fns/programmes'
import { messageFor } from '../lib/errors'
import { DEFAULT_IMPACT_UNIT, IMPACT_UNITS, IMPACT_UNIT_BY_KEY } from '../lib/impactUnits'
import { nextProgrammeColour } from '../lib/programmeColours'
import { TagInput } from './TagInput'
import { RichTextEditor } from './RichTextEditor'
import { Button, ColourPicker, Dialog, Input, Label, Select } from './ui'

// Create or edit a programme (Figma 710:2815). The twin of `RoundDialog`, and for the
// same reason: a programme is a name, some themes, a unit and a statement of what it
// funds — a form, not a page. `/programmes/$programmeId` went with it; the one thing it
// did that this does not is assign the programme to rounds, which now belongs to the
// round dialog alongside the budget that decision is really about.

export type ProgrammeDraft = {
  id?: string
  name: string
  goal: string
  tags: string[]
  impactUnit: string
  impactUnitLabel: string
  colour: string
}

/**
 * A blank draft, pre-assigned the first colour nobody is using. The server assigns one
 * too and is the authority; doing it here as well means the picker opens already showing
 * the answer rather than an empty slot the admin has to fill in before they can start.
 */
export const emptyProgrammeDraft = (taken: Array<string | null>): ProgrammeDraft => ({
  name: '',
  goal: '',
  tags: [],
  impactUnit: DEFAULT_IMPACT_UNIT,
  impactUnitLabel: '',
  colour: nextProgrammeColour(taken),
})

export function ProgrammeDialog({
  open,
  draft,
  suggestions,
  takenColours = {},
  onClose,
  onSaved,
}: {
  open: boolean
  /** `undefined` while closed; an `id`-less draft creates, one with an `id` edits. */
  draft: ProgrammeDraft | undefined
  /** Themes already used elsewhere by this client, offered as autocomplete. */
  suggestions: string[]
  /** hex → the OTHER programme using it, so the picker can say so without forbidding it. */
  takenColours?: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  // Keyed, so opening a different programme resets every field rather than reopening
  // holding the last one's themes.
  return open && draft ? (
    <ProgrammeDialogForm
      key={draft.id ?? 'new'}
      draft={draft}
      suggestions={suggestions}
      takenColours={takenColours}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null
}

const FORM_ID = 'programme-dialog-form'

function ProgrammeDialogForm({
  draft,
  suggestions,
  takenColours,
  onClose,
  onSaved,
}: {
  draft: ProgrammeDraft
  suggestions: string[]
  takenColours: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const editing = draft.id !== undefined
  const [name, setName] = useState(draft.name)
  const [goal, setGoal] = useState(draft.goal)
  const [tags, setTags] = useState<string[]>(draft.tags)
  const [impactUnit, setImpactUnit] = useState(draft.impactUnit)
  const [impactUnitLabel, setImpactUnitLabel] = useState(draft.impactUnitLabel)
  const [colour, setColour] = useState(draft.colour)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A theme typed into the box but never turned into a chip. Clicking Save blurs the
  // input and submits in one gesture, so `TagInput`'s own warning cannot arrive in
  // time — refusing the save here is what actually stops the theme being dropped.
  const [pendingTag, setPendingTag] = useState('')
  const [blockedByTag, setBlockedByTag] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pendingTag) {
      setBlockedByTag(true)
      return
    }
    setBlockedByTag(false)
    setError('')
    setSaving(true)
    try {
      await saveProgramme({
        data: {
          id: draft.id,
          name: name.trim(),
          goal: goal.trim() || null,
          tags,
          impactUnit,
          impactUnitLabel: impactUnitLabel.trim() || null,
          colour,
        },
      })
      onSaved()
    } catch (err) {
      setError(messageFor(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title={editing ? 'Edit Programme' : 'New Programme'}
      description="The theme you fund, the themes used to match applications, and the unit it measures its impact in."
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <div className="flex flex-col gap-3">
          {/* Conditioned on `pendingTag` as well as the blocked flag, so adding the
              theme (or clearing the box) takes the message away by itself — nobody has
              to press Save again to find out they have fixed it. */}
          {blockedByTag && pendingTag && (
            <p role="alert" className="font-display text-body text-danger">
              “{pendingTag}” hasn't been added as a theme yet — press Enter in the box to add it, or
              clear it.
            </p>
          )}
          {error && <p className="font-display text-body text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" form={FORM_ID} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create programme'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="programme-name">Programme name</Label>
          <Input
            id="programme-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter programme name"
            required
            autoFocus
          />
        </div>

        <div>
          <Label>Colour</Label>
          <ColourPicker value={colour} onChange={setColour} taken={takenColours} />
        </div>

        <div>
          <Label htmlFor="programme-themes">Themes</Label>
          <TagInput
            id="programme-themes"
            value={tags}
            onChange={setTags}
            onPendingChange={setPendingTag}
            suggestions={suggestions}
            hint="Choose an existing theme or type a new one, then press Enter"
          />
        </div>

        <div>
          <Label htmlFor="programme-unit">Impact measured in</Label>
          <Select
            id="programme-unit"
            value={impactUnit}
            onChange={setImpactUnit}
            options={IMPACT_UNITS.map((u) => ({ value: u.key, label: u.label }))}
          />
          <p className="mt-1.5 font-display text-label text-gray-500">
            {IMPACT_UNIT_BY_KEY[impactUnit]?.hint}
          </p>
          {impactUnit === 'other' && (
            <div className="mt-3">
              <Label htmlFor="programme-unit-other">Your unit</Label>
              <Input
                id="programme-unit-other"
                value={impactUnitLabel}
                onChange={(e) => setImpactUnitLabel(e.target.value)}
                // Plural, and used verbatim: it is displayed as-is on Insights and read
                // straight into the prompt that pulls figures out of grant reports, so
                // the more specific the phrase, the better the extraction.
                placeholder="e.g. hectares of peatland restored"
                required
              />
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="programme-goal">Objectives, Criteria and Priorities</Label>
          <p className="mb-1.5 font-display text-label text-gray-500">
            Enter the programme's objectives, criteria, and priorities here. This will be used by AI
            to score the applications, so include as much detail as you think is useful.
          </p>
          <RichTextEditor key={draft.id ?? 'new'} defaultValue={goal} onChange={setGoal} />
        </div>
      </form>
    </Dialog>
  )
}
