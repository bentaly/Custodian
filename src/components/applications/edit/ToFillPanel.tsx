import { useState } from 'react'
import { Button, Dialog } from '../../ui'
import { C } from '../../ui/tokens'
import { withAlpha } from '../../BarMeter'
import type { GapToFill } from '../../../lib/fieldMapping/gaps'
import { isEditableField, type EditableField } from '../../../lib/applicationEdit'
import { FieldEditor, type EditOutcome } from './FieldEditor'
import { AnswerPickerDialog } from './AnswerPickerDialog'

// "2 things to fill in", at the top of an application that arrived without something
// a later step needs: the amount (assessment and shortlisting wait on it), the
// applicant's email (nothing can be sent without it), the bank details (nothing can be
// paid without them). Everything else a submission can lack stays in the quieter
// "Not captured" panel at the foot of the page.
//
// Shown to everyone, because a trustee reading the application should know the amount
// is missing too; only an admin gets the buttons. Where the application came in
// through a form, the first way offered is to point at the applicant's own answer,
// which teaches the mapping. Typing is the fallback.

export function ToFillPanel({
  gaps,
  canEdit,
  hasSubmission,
  applicationId,
  organisationName,
  values,
  onSaved,
}: {
  gaps: GapToFill[]
  canEdit: boolean
  hasSubmission: boolean
  applicationId: string
  organisationName: string
  values: Partial<Record<EditableField, string | null>>
  onSaved: (outcome: EditOutcome) => void
}) {
  const [picking, setPicking] = useState<EditableField | null>(null)
  const [typing, setTyping] = useState<{ fields: EditableField[]; label: string } | null>(null)

  if (gaps.length === 0) return null

  const summary = gaps.map((g) => g.blocks).join(' ')

  return (
    <section
      aria-label="Things to fill in"
      className="flex flex-col gap-3 rounded-pill border px-5 py-4"
      style={{
        borderColor: withAlpha(C.warning, 0.25),
        backgroundColor: withAlpha(C.warning, 0.04),
      }}
    >
      <div className="flex flex-col gap-0.5">
        <p className="font-display text-body font-medium" style={{ color: C.ink }}>
          {gaps.length === 1 ? '1 thing to fill in' : `${gaps.length} things to fill in`}
        </p>
        {!canEdit && (
          <p className="font-display text-label" style={{ color: C.sub }}>
            {summary} An admin can add {gaps.length === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>
      {canEdit &&
        gaps.map((g) => {
          const fields = g.keys.filter(isEditableField)
          const single = fields.length === 1 ? fields[0]! : null
          return (
            <div
              key={g.label}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
              style={{ borderColor: withAlpha(C.warning, 0.15) }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-display text-body font-medium" style={{ color: C.ink }}>
                  {g.label}
                </p>
                <p className="font-display text-label" style={{ color: C.sub }}>
                  Not in the submission. {g.blocks}
                </p>
              </div>
              <div className="flex gap-2">
                {single && hasSubmission && (
                  <Button variant="secondary" size="sm" onClick={() => setPicking(single)}>
                    Choose from their answers
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setTyping({ fields, label: g.label })}
                >
                  {single && hasSubmission ? 'Type it' : 'Add'}
                </Button>
              </div>
            </div>
          )
        })}

      {picking && (
        <AnswerPickerDialog
          open
          onClose={() => setPicking(null)}
          applicationId={applicationId}
          organisationName={organisationName}
          field={picking}
          onSaved={onSaved}
          onTypeInstead={() => {
            const field = picking
            setTyping({ fields: [field], label: '' })
          }}
        />
      )}

      <Dialog
        open={typing !== null}
        onClose={() => setTyping(null)}
        title={typing?.label ? `Add ${typing.label.toLowerCase()}` : 'Add'}
        description={organisationName}
        size="sm"
      >
        {typing && (
          <FieldEditor
            applicationId={applicationId}
            fields={typing.fields}
            values={values}
            hint={
              typing.fields.some((f) => f.startsWith('bank'))
                ? 'Bank details are checked for a valid sort code and account number when saved.'
                : undefined
            }
            onCancel={() => setTyping(null)}
            onDone={(outcome) => {
              setTyping(null)
              onSaved(outcome)
            }}
          />
        )}
      </Dialog>
    </section>
  )
}
