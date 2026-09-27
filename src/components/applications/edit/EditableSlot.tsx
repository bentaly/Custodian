import { useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { C } from '../../ui/tokens'
import { FieldEditor, type EditOutcome, type FirstYearEdit } from './FieldEditor'
import type { EditableField } from '../../../lib/applicationEdit'

// Edit in place. At rest the card is exactly what it always was: no pencil, nothing to
// say it can be changed. Hover it (or tab to it) and a pencil appears in its corner;
// press that and the card becomes the fields it shows, with Save and Cancel, in the
// same slot of the page.
//
// One pencil per CARD, not per value: the organisation panel's four facts open
// together, because they are read together and a name corrected without its number
// is half a fix.
//
// Only an admin, and only until a grant is awarded, ever sees the pencil (`canEdit`,
// computed by the server). Everyone else gets the page as it was.

export function EditableSlot({
  canEdit,
  label,
  applicationId,
  fields,
  values,
  onSaved,
  hint,
  firstYear,
  onChooseAnswer,
  children,
  className = '',
}: {
  canEdit: boolean
  /** Names the pencil for a screen reader: "Edit amount requested". */
  label: string
  applicationId: string
  fields: EditableField[]
  values: Partial<Record<EditableField, string | null>>
  onSaved: (outcome: EditOutcome) => void
  hint?: string
  firstYear?: FirstYearEdit
  /** Open the answer picker for a field; the card closes, since the picker saves it. */
  onChooseAnswer?: (field: EditableField) => void
  children: ReactNode
  className?: string
}) {
  const [editing, setEditing] = useState(false)

  if (!canEdit) return <>{children}</>

  if (editing) {
    return (
      <div
        className={`rounded-pill border bg-white p-4 ${className}`}
        style={{ borderColor: C.brandBorder, boxShadow: `0 0 0 3px ${C.brandBg}` }}
      >
        <p className="mb-3 font-display text-body font-medium" style={{ color: C.ink }}>
          {label}
        </p>
        <FieldEditor
          applicationId={applicationId}
          fields={fields}
          values={values}
          hint={hint}
          firstYear={firstYear}
          onChooseAnswer={
            onChooseAnswer
              ? (field) => {
                  setEditing(false)
                  onChooseAnswer(field)
                }
              : undefined
          }
          onCancel={() => setEditing(false)}
          onDone={(outcome) => {
            setEditing(false)
            onSaved(outcome)
          }}
        />
      </div>
    )
  }

  return (
    <div className={`group relative ${className}`}>
      {children}
      <button
        type="button"
        aria-label={label}
        onClick={() => setEditing(true)}
        className="absolute right-2.5 top-2.5 z-20 inline-flex size-7 items-center justify-center rounded-chip border bg-white opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
        style={{ borderColor: C.line, color: C.body }}
      >
        <HugeiconsIcon icon={PencilEdit01Icon} size={14} strokeWidth={1.8} />
      </button>
    </div>
  )
}
