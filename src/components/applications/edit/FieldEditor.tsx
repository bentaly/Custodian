import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button, Input, Label } from '../../ui'
import { C } from '../../ui/tokens'
import { editApplicationFields } from '../../../server/fns/applicationEdits'
import { setFirstYearAmount } from '../../../server/fns/applications'
import {
  editableFieldLabel,
  isNumericField,
  type EditableField,
} from '../../../lib/applicationEdit'

// The form every edit surface uses: a card switching into inputs in place, the gaps
// panel's "Add", the bank details. One field or several, saved together, because a
// sort code without its account number is not worth saving and the server validates
// the whole application at once.

export type EditOutcome = {
  rerun: string[]
  scoreQueued: boolean
  scoreKept: boolean
  appliedToOthers: number
}

/** What a save did, in a sentence, for the notice above the page. */
export function describeOutcome(o: EditOutcome): string {
  const parts: string[] = ['Saved.']
  if (o.rerun.includes('the deprivation lookup')) parts.push('The area has been looked up again.')
  if (o.rerun.includes('due diligence')) parts.push('The register checks have been re-run.')
  if (o.scoreQueued) parts.push('The AI assessment is running now.')
  else if (o.scoreKept)
    parts.push(
      'Re-run the AI assessment when you have finished editing, if you want it to reflect this.',
    )
  if (o.appliedToOthers > 0)
    parts.push(
      `${o.appliedToOthers} other application${o.appliedToOthers === 1 ? ' is' : 's are'} being filled in the same way.`,
    )
  return parts.join(' ')
}

/** A stored value as the text an input starts with: "58000.00" reads as "58000". */
function initialText(field: EditableField, value: string | null | undefined): string {
  if (value == null) return ''
  if (isNumericField(field)) {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : value
  }
  return value
}

/**
 * The share of a shortlisted ask that falls in the round's financial year, edited beside
 * the ask itself: it is a figure ABOUT the amount, and the card that shows both is the
 * one place a person looks for either. Written through `setFirstYearAmount`, which keeps
 * its own rules (shortlisted only, never more than the ask); empty resets it to the
 * suggestion.
 */
export type FirstYearEdit = {
  /** "2026/27" */
  label: string
  /** What is stored, or null when the suggestion stands. */
  stated: number | null
  suggested: number
}

export function FieldEditor({
  applicationId,
  fields,
  values,
  onDone,
  onCancel,
  hint,
  firstYear,
  onChooseAnswer,
}: {
  applicationId: string
  fields: EditableField[]
  /** The current values, keyed by field. */
  values: Partial<Record<EditableField, string | null>>
  onDone: (outcome: EditOutcome) => void
  onCancel: () => void
  /** A line under the inputs: why this matters, what saving will do. */
  hint?: string
  firstYear?: FirstYearEdit
  /**
   * Where the application came in through a form: read this field from one of the
   * applicant's own answers instead of typing it. Offered under every field, because the
   * applicant usually DID answer; we just did not know which answer it was.
   */
  onChooseAnswer?: (field: EditableField) => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, initialText(f, values[f])])),
  )
  // Starts at what is stated, or the suggestion when nobody has said, so the box always
  // shows the figure the round budget is actually counting.
  const yearInitial = firstYear ? String(firstYear.stated ?? Math.round(firstYear.suggested)) : ''
  const [yearDraft, setYearDraft] = useState(yearInitial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = fields.filter((f) => draft[f]!.trim() !== initialText(f, values[f]).trim())
  const yearChanged = firstYear !== undefined && yearDraft.trim() !== yearInitial

  async function save(e: FormEvent) {
    e.preventDefault()
    if (changed.length === 0 && !yearChanged) return onCancel()
    setBusy(true)
    setError(null)
    try {
      const outcome: EditOutcome =
        changed.length > 0
          ? await editApplicationFields({
              data: {
                id: applicationId,
                changes: changed.map((field) => ({ field, value: draft[field]!.trim() || null })),
              },
            })
          : { rerun: [], scoreQueued: false, scoreKept: false, appliedToOthers: 0 }
      if (yearChanged) {
        const text = yearDraft.trim().replace(/[£,\s]/g, '')
        const typed = text === '' ? null : Number(text)
        if (typed !== null && (!Number.isFinite(typed) || typed < 0)) {
          throw new Error(`The ${firstYear!.label} figure must be a number, such as 12000.`)
        }
        // Empty, or the suggestion itself, stores nothing: the suggestion then keeps
        // following the amount if that changes later.
        const amount = typed === Math.round(firstYear!.suggested) ? null : typed
        await setFirstYearAmount({ data: { id: applicationId, amount } })
      }
      await router.invalidate()
      onDone(outcome)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      {fields.map((field) => {
        const id = `edit-${applicationId}-${field}`
        return (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{editableFieldLabel(field)}</Label>
            <Input
              id={id}
              value={draft[field]}
              inputMode={isNumericField(field) ? 'decimal' : undefined}
              placeholder="--"
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
              disabled={busy}
            />
            {onChooseAnswer && (
              <button
                type="button"
                className="self-start font-display text-label underline"
                style={{ color: C.brand }}
                onClick={() => onChooseAnswer(field)}
                disabled={busy}
              >
                Choose from their answers
              </button>
            )}
          </div>
        )
      })}
      {firstYear && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`edit-${applicationId}-first-year`}>In {firstYear.label}</Label>
          <Input
            id={`edit-${applicationId}-first-year`}
            value={yearDraft}
            inputMode="decimal"
            placeholder={String(Math.round(firstYear.suggested))}
            onChange={(e) => setYearDraft(e.target.value)}
            disabled={busy}
          />
          <p className="font-display text-label" style={{ color: C.sub }}>
            How much of the ask is paid in {firstYear.label}, which is what it would draw from the
            round&rsquo;s budget. Suggested: the ask divided by the grant&rsquo;s length.
          </p>
        </div>
      )}
      {hint && (
        <p className="font-display text-label" style={{ color: C.sub }}>
          {hint}
        </p>
      )}
      {error && (
        <p className="font-display text-label" style={{ color: C.danger }} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || (changed.length === 0 && !yearChanged)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
