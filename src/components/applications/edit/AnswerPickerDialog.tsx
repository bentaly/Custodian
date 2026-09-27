import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button, Checkbox, Dialog, Input, Label } from '../../ui'
import { C } from '../../ui/tokens'
import {
  answerCandidates,
  countOthersMissing,
  editApplicationFields,
} from '../../../server/fns/applicationEdits'
import { editableFieldLabel, type EditableField } from '../../../lib/applicationEdit'
import type { EditOutcome } from './FieldEditor'

// "Which answer is the amount requested?" The way to fill a field that teaches
// something. The applicant almost always DID answer the question; we just did not know
// which of their answers it was. Pointing at it fixes this application, can teach the
// foundation's mapping so the next submission reads it the same way, and can fill in
// the others that answered the same question.
//
// The reading is shown and editable before anything is saved, because answers are
// written by people: "58k across the three years" is £58,000 to a person and £58 to a
// regular expression. Only an answer that reads as a plain figure is prefilled, and
// only those are carried to the other applications.

type Answer = { label: string; value: string; reading: string | null }

export function AnswerPickerDialog({
  open,
  onClose,
  applicationId,
  organisationName,
  field,
  onSaved,
  onTypeInstead,
}: {
  open: boolean
  onClose: () => void
  applicationId: string
  organisationName: string
  field: EditableField
  onSaved: (outcome: EditOutcome) => void
  onTypeInstead: () => void
}) {
  const router = useRouter()
  const label = editableFieldLabel(field)
  const [answers, setAnswers] = useState<Answer[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [reading, setReading] = useState('')
  const [remember, setRemember] = useState(true)
  const [others, setOthers] = useState<{ readable: number; unreadable: number } | null>(null)
  const [applyToOthers, setApplyToOthers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAnswers(null)
    setChosen(null)
    setReading('')
    setError(null)
    let live = true
    answerCandidates({ data: { id: applicationId, field } })
      .then((r) => live && setAnswers(r.answers))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the answers'))
    return () => {
      live = false
    }
  }, [open, applicationId, field])

  useEffect(() => {
    setOthers(null)
    if (!chosen) return
    let live = true
    countOthersMissing({ data: { id: applicationId, field, sourceKey: chosen } })
      .then((r) => live && setOthers({ readable: r.readable.length, unreadable: r.unreadable }))
      .catch(() => live && setOthers(null))
    return () => {
      live = false
    }
  }, [chosen, applicationId, field])

  function choose(a: Answer) {
    setChosen(a.label)
    setReading(a.reading ?? '')
  }

  async function save() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await editApplicationFields({
        data: {
          id: applicationId,
          changes: [{ field, value: reading.trim() || null, sourceKey: chosen }],
          remember,
          applyToOthers: applyToOthers && (others?.readable ?? 0) > 0,
        },
      })
      await router.invalidate()
      onSaved(outcome)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title={`Which answer is the ${label.toLowerCase()}?`}
      description={`${organisationName} · answers from their submission not already used for anything`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !chosen || !reading.trim()}>
            {busy ? 'Saving…' : 'Use this answer'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        {answers === null && !error && (
          <p className="font-display text-body" style={{ color: C.sub }}>
            Loading their answers…
          </p>
        )}
        {answers?.length === 0 && (
          <p className="font-display text-body" style={{ color: C.sub }}>
            Every answer in this submission is already used for something.
          </p>
        )}
        {answers?.map((a) => {
          const on = a.label === chosen
          return (
            <label
              key={a.label}
              className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-control border p-3.5"
              style={{
                borderColor: on ? C.brand : C.line,
                backgroundColor: on ? C.brandWash : C.white,
              }}
            >
              <input
                type="radio"
                name="answer"
                className="mt-0.5"
                checked={on}
                onChange={() => choose(a)}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-display text-label" style={{ color: C.sub }}>
                  {a.label}
                </span>
                <span className="break-words font-display text-body" style={{ color: C.ink }}>
                  {a.value}
                </span>
                {on && (
                  <span className="mt-2 flex items-center gap-2">
                    <Label htmlFor="answer-reading" className="mb-0 shrink-0">
                      Read as
                    </Label>
                    <Input
                      id="answer-reading"
                      className="max-w-[200px]"
                      value={reading}
                      placeholder={a.reading ? undefined : 'Type the figure'}
                      onChange={(e) => setReading(e.target.value)}
                    />
                  </span>
                )}
              </span>
            </label>
          )
        })}

        <p className="px-0.5 font-display text-label" style={{ color: C.sub }}>
          None of these?{' '}
          <button
            type="button"
            className="underline"
            style={{ color: C.brand }}
            onClick={() => {
              onClose()
              onTypeInstead()
            }}
          >
            Type the {label.toLowerCase()} instead
          </button>
          . That fixes this application only.
        </p>

        {chosen && (
          <div
            className="mt-1 flex flex-col gap-3 rounded-control p-3.5"
            style={{ backgroundColor: C.wash }}
          >
            <Checkbox
              className="items-start"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              label={
                <span className="flex flex-col gap-0.5">
                  <span className="font-display text-body font-medium" style={{ color: C.ink }}>
                    Read &ldquo;{chosen}&rdquo; as the {label.toLowerCase()} from now on
                  </span>
                  <span className="font-display text-label" style={{ color: C.sub }}>
                    For every future application. Choosing a different answer later replaces this.
                  </span>
                </span>
              }
            />
            {others && others.readable > 0 && (
              <Checkbox
                className="items-start"
                checked={applyToOthers}
                onChange={(e) => setApplyToOthers(e.target.checked)}
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="font-display text-body font-medium" style={{ color: C.ink }}>
                      Also fill in the {others.readable} other application
                      {others.readable === 1 ? '' : 's'} missing it
                    </span>
                    <span className="font-display text-label" style={{ color: C.sub }}>
                      {others.readable === 1 ? 'It' : 'All of them'} answered this question with a
                      plain figure. Each is marked Edited so you can check it.
                      {others.unreadable > 0 &&
                        ` ${others.unreadable} more answered in words, so they are left for you.`}
                    </span>
                  </span>
                }
              />
            )}
          </div>
        )}

        {error && (
          <p className="font-display text-label" style={{ color: C.danger }} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
