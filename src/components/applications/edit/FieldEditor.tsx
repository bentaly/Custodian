import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button, Input, Label } from '../../ui'
import { C } from '../../ui/tokens'
import { editApplicationFields } from '../../../server/fns/applicationEdits'
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
  if (o.scoreQueued) parts.push('The AI assessment is being re-run.')
  else if (o.scoreKept)
    parts.push(
      'The AI assessment was left as it is, because a decision is already under way. Re-run it from the assessment panel if you want it to reflect this.',
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

export function FieldEditor({
  applicationId,
  fields,
  values,
  onDone,
  onCancel,
  hint,
}: {
  applicationId: string
  fields: EditableField[]
  /** The current values, keyed by field. */
  values: Partial<Record<EditableField, string | null>>
  onDone: (outcome: EditOutcome) => void
  onCancel: () => void
  /** A line under the inputs: why this matters, what saving will do. */
  hint?: string
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, initialText(f, values[f])])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = fields.filter((f) => draft[f]!.trim() !== initialText(f, values[f]).trim())

  async function save(e: FormEvent) {
    e.preventDefault()
    if (changed.length === 0) return onCancel()
    setBusy(true)
    setError(null)
    try {
      const outcome = await editApplicationFields({
        data: {
          id: applicationId,
          changes: changed.map((field) => ({ field, value: draft[field]!.trim() || null })),
        },
      })
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
          </div>
        )
      })}
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
        <Button type="submit" size="sm" disabled={busy || changed.length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
