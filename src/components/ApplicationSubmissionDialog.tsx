import { Dialog } from './ui'
import { C } from './ui/tokens'
import {
  AnswerBody,
  ApplicationFields,
  answerFor,
  type ApplicationFieldsData,
} from './ApplicationFields'
import { CANONICAL_FIELD_BY_KEY, type CanonicalFieldKey } from '../lib/fieldMapping'
import { fmtDate, humaniseKey } from '../lib/format'
import { budgetSummary, type EditRecord } from './applications/edit/EditedMark'

// View Submission: what the applicant sent, exactly as it arrived.
//
// Since applications became editable this is the one place the ORIGINAL is always
// visible. Where an application came in through a form, every answer is shown in the
// applicant's wording and order, straight from the stored payload, and beneath any
// answer Custodian now reads differently there is a note saying what it reads instead,
// who decided, and when. Nothing here is ever rewritten by an edit.
//
// An application with no stored submission (an import, a seed) was never a form, so
// the fields are shown from the application as before, with the changes listed at the
// top instead of under answers that do not exist.

type SubmissionApplication = ApplicationFieldsData & {
  organisationName: string
  submission?: Array<{ label: string; value: string; canonical: string | null }> | null
  edits?: EditRecord[]
}

const fieldLabel = (key: string) =>
  key === 'themes'
    ? 'Themes'
    : (CANONICAL_FIELD_BY_KEY[key as CanonicalFieldKey]?.label ?? humaniseKey(key))

function money(field: string, value: string | null): string | null {
  if (value == null) return null
  if (field === 'budgetBreakdown') return budgetSummary(value)
  if (field === 'amountRequested' || field === 'unrestrictedReserves') {
    const n = Number(value)
    return Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : value
  }
  return value
}

/** "Alex Taylor, 26 Sep 2026" */
function byline(e: EditRecord): string {
  if (e.method === 'register')
    return `from the Charity Commission register, ${fmtDate(new Date(e.createdAt))}`
  return `${e.editorName ?? 'Someone'}, ${fmtDate(new Date(e.createdAt))}`
}

export function Note({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-chip px-2.5 py-2 font-display text-label"
      style={{ backgroundColor: C.infoWash, color: C.info }}
    >
      <span
        className="shrink-0 rounded-pill bg-white px-2 py-0.5 text-micro font-semibold"
        style={{ color: C.info }}
      >
        {tag}
      </span>
      <span>{children}</span>
    </div>
  )
}

export function ApplicationSubmissionDialog({
  application,
  programmeName,
  open,
  onClose,
}: {
  application: SubmissionApplication
  /** The programme applied to — a field of the submission that lives on the round
   *  programme rather than on the application, so the renderer cannot reach it. */
  programmeName?: string | null
  open: boolean
  onClose: () => void
}) {
  const edits = application.edits ?? []
  const latestByField = new Map<string, EditRecord>()
  for (const e of edits) latestByField.set(e.field, e)
  const changedCount = latestByField.size

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Application form"
      description={application.organisationName}
      size="lg"
    >
      {changedCount > 0 && (
        <p
          className="mb-4 rounded-chip px-3 py-2.5 font-display text-label"
          style={{ backgroundColor: C.wash, color: C.body }}
        >
          Exactly as received. Where Custodian reads something differently, it says so in blue.{' '}
          <span className="font-medium">
            {changedCount} {changedCount === 1 ? 'change' : 'changes'}
          </span>
        </p>
      )}
      {application.submission ? (
        <AsReceived
          application={application}
          submission={application.submission}
          edits={edits}
          latestByField={latestByField}
          programmeName={programmeName}
        />
      ) : (
        <>
          {changedCount > 0 && <ChangesList latestByField={latestByField} edits={edits} />}
          <ApplicationFields application={application} programmeName={programmeName} />
        </>
      )}
    </Dialog>
  )
}

function AsReceived({
  application,
  submission,
  edits,
  latestByField,
  programmeName,
}: {
  application: SubmissionApplication
  submission: Array<{ label: string; value: string; canonical: string | null }>
  edits: EditRecord[]
  latestByField: Map<string, EditRecord>
  programmeName?: string | null
}) {
  // Fields filled in that no answer of theirs speaks to (typed where nothing was
  // sent, or themes): listed first, since there is no answer to put them under.
  const labels = new Set(submission.map((s) => s.label))
  const unanchored = [...latestByField.values()].filter((e) => {
    const anchored = edits.some(
      (x) =>
        x.field === e.field &&
        ((x.sourceKey && labels.has(x.sourceKey)) ||
          (x.replacedSourceKey && labels.has(x.replacedSourceKey))),
    )
    // A budget correction sits under the budget answer, where there is one.
    const budgetAnswer =
      e.field === 'budgetBreakdown' && submission.some((s) => s.canonical === 'budgetBreakdown')
    return !anchored && !budgetAnswer
  })

  return (
    <>
      {unanchored.length > 0 && (
        <ChangesList
          latestByField={new Map(unanchored.map((e) => [e.field, e]))}
          edits={edits}
          title="Added in Custodian"
        />
      )}
      <dl className="flex flex-col">
        {submission.map((s, i) => {
          // What this answer is now read as, if a person pointed a field at it.
          const usedFor = [...latestByField.values()].find((e) => e.sourceKey === s.label)
          // A field that USED to be read from this answer and now reads something else.
          const replacedIn = edits.find((e) => e.replacedSourceKey === s.label)
          const replacedNow = replacedIn ? latestByField.get(replacedIn.field) : undefined
          // The budget's lines are shown as lines. Once somebody has corrected them the
          // columns hold the correction, so the ORIGINAL comes from the first edit's
          // record of what was there, and the correction is noted beneath.
          const budgetEdit =
            s.canonical === 'budgetBreakdown' ? latestByField.get('budgetBreakdown') : undefined
          const originalLines = budgetEdit
            ? (() => {
                const first = edits.find((e) => e.field === 'budgetBreakdown')
                try {
                  return first?.previousValue ? JSON.parse(first.previousValue) : null
                } catch {
                  return null
                }
              })()
            : null
          const shaped = budgetEdit
            ? originalLines
              ? ({ kind: 'budget', lines: originalLines } as const)
              : null
            : s.canonical === 'budgetBreakdown' || s.canonical === 'budgetBreakdownLink'
              ? answerFor(application, s.canonical, programmeName)
              : null
          return (
            <div
              key={`${s.label}-${i}`}
              className={i > 0 ? 'mt-4 border-t pt-4 pb-1' : 'pb-1'}
              style={i > 0 ? { borderColor: C.line } : undefined}
            >
              <dt className="mb-1.5 font-display text-label font-medium" style={{ color: C.sub }}>
                {/* A payload that named a field by OUR key ("amountRequested") gets our
                    label for it; a form's own question wording is shown as they wrote it. */}
                {s.label === s.canonical ? fieldLabel(s.label) : humaniseKey(s.label)}
              </dt>
              <dd>
                {shaped ? (
                  <AnswerBody answer={shaped} />
                ) : (
                  <p
                    className="whitespace-pre-line break-words font-display text-body"
                    style={{ color: C.ink }}
                  >
                    {s.value}
                  </p>
                )}
                {budgetEdit ? (
                  <Note tag="Changed">
                    Custodian uses <b>{budgetSummary(budgetEdit.newValue) ?? 'no breakdown'}</b> ·{' '}
                    {byline(budgetEdit)}
                  </Note>
                ) : usedFor ? (
                  <Note tag={usedFor.method === 'applied' ? 'Filled in' : 'Used as'}>
                    {fieldLabel(usedFor.field)},{' '}
                    <b>{money(usedFor.field, usedFor.newValue) ?? 'withheld'}</b> ·{' '}
                    {usedFor.method === 'applied'
                      ? `filled in when ${usedFor.editorName ?? 'someone'} fixed another application, ${fmtDate(new Date(usedFor.createdAt))}`
                      : `chosen by ${byline(usedFor)}`}
                  </Note>
                ) : replacedIn && replacedNow && replacedNow.sourceKey !== s.label ? (
                  <Note tag="Changed">
                    Custodian uses{' '}
                    <b>{money(replacedNow.field, replacedNow.newValue) ?? 'nothing'}</b> for the{' '}
                    {fieldLabel(replacedNow.field).toLowerCase()} · {byline(replacedNow)}
                  </Note>
                ) : null}
              </dd>
            </div>
          )
        })}
      </dl>
    </>
  )
}

/** The changes as a list, for fields with no answer to sit beneath. */
function ChangesList({
  latestByField,
  edits,
  title = 'Changed in Custodian',
}: {
  latestByField: Map<string, EditRecord>
  edits: EditRecord[]
  title?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-1.5">
      <p
        className="font-display text-label font-medium uppercase"
        style={{ color: C.sub, letterSpacing: '0.06em' }}
      >
        {title}
      </p>
      {[...latestByField.values()].map((e) => {
        const first = edits.find((x) => x.field === e.field)
        const now =
          e.field === 'themes'
            ? (JSON.parse(e.newValue ?? '[]') as string[]).join(', ')
            : money(e.field, e.newValue)
        const was =
          e.field === 'themes'
            ? first?.previousValue
              ? (JSON.parse(first.previousValue) as string[]).join(', ')
              : null
            : money(e.field, first?.previousValue ?? null)
        return (
          <div
            key={e.field}
            className="rounded-chip px-3 py-2 font-display text-label"
            style={{ backgroundColor: C.infoWash, color: C.info }}
          >
            <b>{fieldLabel(e.field)}</b>: {now ?? 'cleared'}
            {was ? ` (was ${was})` : ' (not in the submission)'} · {byline(e)}
          </div>
        )
      })}
    </div>
  )
}
