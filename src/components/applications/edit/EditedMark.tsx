import { Tooltip } from '../../ui'
import { C } from '../../ui/tokens'
import { fmtDate } from '../../../lib/format'

// The one thing an edited application wears at rest: a small blue dot and the word
// "Edited" beside the value somebody changed. Hover or focus it for who, when, and
// what the applicant actually said. The fuller story lives in View Submission.

export type EditRecord = {
  field: string
  method: string
  previousValue: string | null
  newValue: string | null
  sourceKey: string | null
  replacedSourceKey: string | null
  editorName: string | null
  createdAt: Date | string
}

/** The latest change to each field, which is what a mark describes. */
export function latestEdits(edits: EditRecord[]): Map<string, EditRecord> {
  const latest = new Map<string, EditRecord>()
  for (const e of edits) latest.set(e.field, e)
  return latest
}

/** The FIRST change to a field holds what the application said before anyone touched it. */
function firstEdit(edits: EditRecord[], field: string): EditRecord | undefined {
  return edits.find((e) => e.field === field)
}

function describe(edit: EditRecord, original: EditRecord | undefined): string {
  const who = edit.editorName ?? 'Someone'
  const when = fmtDate(new Date(edit.createdAt))
  const how =
    edit.method === 'themes'
      ? `${who} chose these themes on ${when}.`
      : edit.method === 'applied'
        ? `Filled in on ${when} from the applicant's answer to "${edit.sourceKey}", when ${who} fixed the same thing on another application.`
        : edit.method === 'answer'
          ? `${who} read this from the applicant's answer to "${edit.sourceKey}" on ${when}.`
          : `${who} changed this on ${when}.`
  if (edit.method === 'themes') return `${how} The AI assessment will not change them.`
  const before = original?.previousValue
  return before ? `${how} It was "${before}".` : `${how} The submission did not include it.`
}

export function EditedMark({ field, edits }: { field: string; edits: EditRecord[] }) {
  const latest = [...edits].reverse().find((e) => e.field === field)
  if (!latest) return null
  return (
    <Tooltip
      label="About this change"
      trigger={
        <span
          className="inline-flex items-center gap-1 font-display text-micro font-medium"
          style={{ color: C.info }}
        >
          <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: C.info }} />
          Edited
        </span>
      }
    >
      {describe(latest, firstEdit(edits, field))}
    </Tooltip>
  )
}
