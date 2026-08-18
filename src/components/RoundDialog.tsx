import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { saveRound } from '../server/fns/rounds'
import { messageFor } from '../lib/errors'
import { Button, DateField, Dialog, Input, Label, Select, TOKENS, Tooltip } from './ui'

// Create or edit a funding round — the whole thing, in one dialog (Figma 674:32922).
// This replaced a separate `/rounds/$roundId` detail screen: a round is a name, two
// dates and a list of programme budgets, which is a form, not a page. Editing it in
// place also means the list behind it is still on screen, so "is this the round I
// meant?" never costs a navigation.

export type RoundProgrammeDraft = {
  programmeId: string
  budget: string
  maxGrantAmount: string
  grantDurationYears: string
}

export type RoundDraft = {
  id?: string
  name: string
  openedAt: string
  closedAt: string
  programmes: RoundProgrammeDraft[]
}

/** Programmes the client has, to populate the picker. */
export type PickableProgramme = { id: string; name: string }

const emptyRow = (): RoundProgrammeDraft => ({
  programmeId: '',
  budget: '',
  maxGrantAmount: '',
  grantDurationYears: '',
})

export function RoundDialog({
  open,
  draft,
  programmes,
  onClose,
  onSaved,
}: {
  open: boolean
  /** `undefined` while closed; an `id`-less draft creates, one with an `id` edits. */
  draft: RoundDraft | undefined
  programmes: PickableProgramme[]
  onClose: () => void
  onSaved: () => void
}) {
  // Keyed by the round being edited, so opening a different row resets every field —
  // without this the dialog would reopen holding the previous round's budgets.
  return open && draft ? (
    <RoundDialogForm
      key={draft.id ?? 'new'}
      draft={draft}
      programmes={programmes}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null
}

function RoundDialogForm({
  draft,
  programmes,
  onClose,
  onSaved,
}: {
  draft: RoundDraft
  programmes: PickableProgramme[]
  onClose: () => void
  onSaved: () => void
}) {
  const editing = draft.id !== undefined
  const [name, setName] = useState(draft.name)
  const [openedAt, setOpenedAt] = useState(draft.openedAt)
  const [closedAt, setClosedAt] = useState(draft.closedAt)
  const [rows, setRows] = useState<RoundProgrammeDraft[]>(
    draft.programmes.length > 0 ? draft.programmes : [emptyRow()],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const nameById = useMemo(() => new Map(programmes.map((p) => [p.id, p.name])), [programmes])

  // Would saving change anything? Compared against the rows as they would be SUBMITTED,
  // which is why the blank trailing row is dropped first exactly as `handleSubmit` drops
  // it — otherwise opening a round with no programmes yet would look dirty on sight,
  // because the form seeds itself with one empty row to invite the first entry.
  const submittedRows = rows.filter((r) => r.programmeId !== '')
  const dirty =
    name.trim() !== draft.name.trim() ||
    openedAt !== draft.openedAt ||
    closedAt !== draft.closedAt ||
    submittedRows.length !== draft.programmes.length ||
    submittedRows.some((r, i) => {
      const was = draft.programmes[i]
      return (
        !was ||
        r.programmeId !== was.programmeId ||
        r.budget !== was.budget ||
        r.maxGrantAmount !== was.maxGrantAmount ||
        r.grantDurationYears !== was.grantDurationYears
      )
    })

  // The round's budget is the sum of what its programmes are given — there is no
  // separate pot it could hold that these allocations don't already describe.
  const totalBudget = rows.reduce((sum, r) => sum + (parseFloat(r.budget) || 0), 0)

  function patch(index: number, changes: Partial<RoundProgrammeDraft>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...changes } : r)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // A blank trailing row is how the form invites the next programme, not an entry —
    // dropping it here means the admin never has to tidy up before saving.
    const filled = rows.filter((r) => r.programmeId !== '')
    setSaving(true)
    try {
      await saveRound({
        data: {
          id: draft.id,
          name: name.trim(),
          openedAt,
          closedAt,
          programmes: filled.map((r) => ({
            programmeId: r.programmeId,
            budget: parseFloat(r.budget) || 0,
            maxGrantAmount: r.maxGrantAmount ? parseFloat(r.maxGrantAmount) : null,
            grantDurationYears: r.grantDurationYears ? parseInt(r.grantDurationYears, 10) : null,
          })),
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
      title={editing ? 'Edit Funding Round' : 'New Funding Round'}
      description="Define the funding period, budget, and programmes for this round."
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <div className="flex flex-col gap-3">
          {error && <p className="font-display text-body text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" form={FORM_ID} disabled={saving || !dirty}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create round'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="round-name">Round name</Label>
          <Input
            id="round-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter round name"
            required
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="round-opens">Opens</Label>
            <DateField id="round-opens" value={openedAt} onChange={setOpenedAt} required />
          </div>
          <div className="flex-1">
            <Label htmlFor="round-closes">Closes</Label>
            {/* `min` is the guard the schema also enforces: a round that closes before
                it opens is never open, and the browser can say so before a round trip. */}
            <DateField
              id="round-closes"
              value={closedAt}
              min={openedAt || undefined}
              onChange={setClosedAt}
              required
            />
          </div>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 font-display text-body font-medium text-grey-700">
            Programmes this round funds
          </legend>

          <div className="hidden gap-3 sm:flex">
            <ColumnHeader className="flex-1" label="Programme" />
            <ColumnHeader className="w-[128px]" label="Budget" />
            <ColumnHeader className="w-[128px]" label="Max per award">
              The most any one applicant can be awarded from this programme's budget. Shown to
              reviewers as a guardrail. Leave blank for no ceiling.
            </ColumnHeader>
            <ColumnHeader className="w-[112px]" label="Max duration">
              How many years grants from this programme usually run, used to show an annualised
              figure alongside the total. Leave blank if it varies.
            </ColumnHeader>
            <span className="w-5 shrink-0" />
          </div>

          {rows.map((row, i) => {
            const taken = new Set(rows.filter((_, j) => j !== i).map((r) => r.programmeId))
            return (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-chip border border-grey-200 p-3 sm:flex-row sm:items-center sm:rounded-none sm:border-0 sm:p-0"
              >
                <div className="flex-1">
                  <MobileLabel>Programme</MobileLabel>
                  <Select
                    value={row.programmeId}
                    aria-label={`Programme ${i + 1}`}
                    onChange={(v) => patch(i, { programmeId: v })}
                    placeholder="Select programme"
                    options={programmes.map((p) => ({
                      value: p.id,
                      label: p.name,
                      disabled: taken.has(p.id),
                    }))}
                  />
                </div>

                <div className="sm:w-[128px]">
                  <MobileLabel>Budget</MobileLabel>
                  <MoneyInput
                    value={row.budget}
                    label={`Budget for ${nameById.get(row.programmeId) ?? `programme ${i + 1}`}`}
                    placeholder="Amount"
                    required={row.programmeId !== ''}
                    onChange={(v) => patch(i, { budget: v })}
                  />
                </div>

                <div className="sm:w-[128px]">
                  <MobileLabel>Max per award</MobileLabel>
                  <MoneyInput
                    value={row.maxGrantAmount}
                    label={`Max per award for ${nameById.get(row.programmeId) ?? `programme ${i + 1}`}`}
                    placeholder="Optional"
                    onChange={(v) => patch(i, { maxGrantAmount: v })}
                  />
                </div>

                <div className="sm:w-[112px]">
                  <MobileLabel>Max duration</MobileLabel>
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      inputMode="numeric"
                      value={row.grantDurationYears}
                      aria-label={`Duration in years for ${nameById.get(row.programmeId) ?? `programme ${i + 1}`}`}
                      placeholder="Optional"
                      onChange={(e) => patch(i, { grantDurationYears: e.target.value })}
                      className={row.grantDurationYears ? 'pr-12' : undefined}
                    />
                    {row.grantDurationYears && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-display text-body text-grey-400">
                        {row.grantDurationYears === '1' ? 'year' : 'years'}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  aria-label={`Remove ${nameById.get(row.programmeId) ?? `programme ${i + 1}`}`}
                  className="flex shrink-0 self-end rounded-full p-1 text-danger transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden sm:self-auto"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={20} color="currentColor" />
                </button>
              </div>
            )
          })}

          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
              disabled={rows.length >= programmes.length}
              className="flex items-center gap-2 self-start font-display text-body font-medium text-brand transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden disabled:opacity-40"
            >
              <HugeiconsIcon icon={Add01Icon} size={16} color="currentColor" />
              Add programme
            </button>

            <p className="font-display text-body text-grey-500">
              Total budget{' '}
              <span className="font-medium text-grey-900 tabular-nums">
                £{totalBudget.toLocaleString('en-GB')}
              </span>
            </p>
          </div>
        </fieldset>
      </form>
    </Dialog>
  )
}

// The submit button lives in the pinned footer, outside the scrolling body — `form`
// associates it with the form it is no longer inside, so Enter in a field still submits.
const FORM_ID = 'round-dialog-form'

function ColumnHeader({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  /** When given, an ⓘ sits after the label and this is what it explains. */
  children?: React.ReactNode
}) {
  return (
    <span
      className={`flex items-center gap-1 font-display text-label font-medium text-grey-500 ${className ?? ''}`}
    >
      {label}
      {children && <Tooltip label={`About ${label.toLowerCase()}`}>{children}</Tooltip>}
    </span>
  )
}

/** The column headers are hidden on a phone, where each row stacks; these stand in. */
function MobileLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block font-display text-label font-medium text-grey-500 sm:hidden">
      {children}
    </span>
  )
}

/** A money box with the £ inside it, in brand green, as the comp draws it. */
function MoneyInput({
  value,
  label,
  placeholder,
  required,
  onChange,
}: {
  value: string
  label: string
  placeholder: string
  required?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-display text-body font-medium"
        style={{ color: TOKENS.brand }}
      >
        £
      </span>
      <Input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7"
      />
    </div>
  )
}
