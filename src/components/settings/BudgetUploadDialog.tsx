import { useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Download04Icon, File01Icon, Upload04Icon } from '@hugeicons/core-free-icons'
import { Button, Dialog, ErrorNote, Select, TOKENS as C } from '../ui'
import { fmtMoney } from '../../lib/format'
import { periodsIn } from '../../lib/coreCosts'
import type { Candidate, ValueResolution } from '../../lib/dataImport/match'
import {
  inferTypes,
  parseBudgetRows,
  resolveProgrammes,
  rowKey,
  rowPlace,
  translateBudget,
  type AmountBasis,
  type ParsedBudgetRow,
  type RowNote,
  type Translation,
  type UploadType,
} from '../../lib/budgetUpload/translate'
import type { TemplateLine } from '../../lib/budgetUpload/workbook'

/**
 * Settings → Annual budget → Upload a budget.
 *
 * Download a template (prefilled with the year as it stands), upload it back, check what
 * Custodian made of it, and put the result in the form. It follows the onboarding
 * import's shape (`/settings/data-import`): the file is read in the browser, exact
 * programme names apply silently, anything else is asked once per distinct value, and
 * nothing is saved here. The rules are `src/lib/budgetUpload/translate.ts`.
 *
 * "Put these in the form" REPLACES the form's lines, the same way a save replaces the
 * year's list, and the review says so before anyone presses it.
 */

type Props = {
  open: boolean
  onClose: () => void
  onApply: (t: Translation) => void
  clientId: string
  foundationName: string
  financialYear: { start: string; end: string; label: string }
  programmes: Candidate[]
  /** The form's lines as they stand, to prefill the template. */
  currentLines: TemplateLine[]
}

type Prepared = {
  fileName: string
  rows: ParsedBudgetRow[]
  notes: RowNote[]
  resolutions: ValueResolution[]
  /** The year the template was made for, when it is not this one. */
  otherYear: string | null
}

const LEAVE_OUT = '~leave-out'

const BASIS_OPTIONS = [
  { value: 'year', label: 'For the whole year' },
  { value: 'payment', label: 'For each payment (per month or quarter)' },
]

const TYPE_OPTIONS = [
  { value: 'cost', label: 'Cost' },
  { value: 'income', label: 'Income' },
  { value: LEAVE_OUT, label: 'Leave it out' },
]

export function BudgetUploadDialog(props: Props) {
  const { open, onClose, financialYear: fy } = props
  const [busy, setBusy] = useState<'template' | 'upload' | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [programmeChoice, setProgrammeChoice] = useState<Record<string, string | null>>({})
  const [typeChoice, setTypeChoice] = useState<Record<string, UploadType | null>>({})
  const [basis, setBasis] = useState<AmountBasis>('year')
  const fileInput = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPrepared(null)
    setProgrammeChoice({})
    setTypeChoice({})
    setBasis('year')
    setError('')
  }
  const close = () => {
    reset()
    onClose()
  }

  async function handleDownload() {
    setBusy('template')
    setError('')
    try {
      const { buildBudgetTemplate } = await import('../../lib/budgetUpload/workbook')
      const blob = await buildBudgetTemplate({
        clientId: props.clientId,
        foundationName: props.foundationName,
        yearLabel: fy.label,
        programmes: props.programmes.map((p) => p.name),
        lines: props.currentLines,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `custodian-budget-${fy.label.replace(/[^0-9]+/g, '-')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the template.')
    } finally {
      setBusy(null)
    }
  }

  async function handleFile(file: File) {
    setBusy('upload')
    setError('')
    try {
      const { readBudgetWorkbook, BudgetWorkbookError } =
        await import('../../lib/budgetUpload/workbook')
      const read = await readBudgetWorkbook(file)
      // A template made for another foundation would bring its programme names here.
      if (read.fingerprint && read.fingerprint.clientId !== props.clientId) {
        throw new BudgetWorkbookError(
          'That template was made for a different foundation. Download a fresh one here.',
        )
      }
      const parsed = parseBudgetRows(read.rows)
      const rows = inferTypes(parsed.rows, props.programmes)
      const resolutions = resolveProgrammes(rows, props.programmes)
      if (rows.length === 0 && parsed.notes.length === 0) {
        throw new BudgetWorkbookError('That file has no lines with an amount in it.')
      }
      // A close match is pre-selected, to be confirmed; nothing close is left for a pick.
      const preset: Record<string, string | null> = {}
      for (const r of resolutions) {
        if (r.match.kind === 'suggestion') preset[r.value] = r.match.candidate.id
      }
      setProgrammeChoice(preset)
      setPrepared({
        fileName: file.name,
        rows,
        notes: parsed.notes,
        resolutions,
        otherYear:
          read.fingerprint && read.fingerprint.yearLabel !== fy.label
            ? read.fingerprint.yearLabel
            : null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const openProgrammes = prepared?.resolutions.filter((r) => r.match.kind !== 'exact') ?? []
  const untyped = prepared?.rows.filter((r) => r.type === null) ?? []
  const unresolved =
    openProgrammes.filter((r) => programmeChoice[r.value] === undefined).length +
    untyped.filter((r) => typeChoice[rowKey(r)] === undefined).length

  const translation = useMemo(
    () =>
      prepared
        ? translateBudget(
            prepared.rows,
            { programmes: programmeChoice, types: typeChoice, basis },
            prepared.resolutions,
            fy,
          )
        : null,
    [prepared, programmeChoice, typeChoice, basis, fy],
  )
  const periodic = prepared?.rows.find((r) => r.type !== 'programme' && r.frequency !== 'one_off')
  const notes = [...(prepared?.notes ?? []), ...(translation?.notes ?? [])].sort(
    (a, b) => a.sheet.localeCompare(b.sheet) || a.rowNumber - b.rowNumber,
  )
  const counts = translation
    ? {
        programmes: translation.programmeAmounts.size,
        costs: translation.lines.filter((l) => l.kind === 'cost').length,
        income: translation.lines.filter((l) => l.kind === 'income').length,
      }
    : null

  const programmeOptions = [
    ...props.programmes.map((p) => ({ value: p.id, label: p.name })),
    { value: LEAVE_OUT, label: 'Leave it out' },
  ]

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy !== null}
      size="lg"
      title={`Upload a budget for ${fy.label}`}
      description="Fill in the template, upload it, and check what Custodian made of it. Nothing is saved until you press Save budget."
      footer={
        prepared && translation ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={reset}>
              Choose another file
            </Button>
            <Button
              disabled={unresolved > 0}
              title={unresolved > 0 ? 'Answer the questions above first' : undefined}
              onClick={() => {
                props.onApply(translation)
                close()
              }}
            >
              Put these in the form
            </Button>
          </div>
        ) : undefined
      }
    >
      {!prepared ? (
        <div className="flex flex-col gap-4 font-display text-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p style={{ color: C.sub }}>
              The template already holds this year&rsquo;s budget and a row for each programme.
            </p>
            <Button
              variant="secondary"
              icon={Download04Icon}
              disabled={busy !== null}
              onClick={handleDownload}
            >
              {busy === 'template' ? 'Building…' : 'Download template'}
            </Button>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void handleFile(file)
            }}
            className="rounded-control border-2 border-dashed px-6 py-10 text-center transition-colors"
            style={{ borderColor: dragging ? C.brand : C.line }}
          >
            <HugeiconsIcon
              icon={Upload04Icon}
              className="mx-auto h-7 w-7"
              strokeWidth={1.5}
              style={{ color: dragging ? C.brand : 'var(--color-grey-400)' }}
            />
            <div className="mt-3" style={{ color: C.ink }}>
              {busy === 'upload' ? (
                'Reading your workbook…'
              ) : (
                <>
                  Drop your budget here, or{' '}
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="font-medium underline underline-offset-2"
                    style={{ color: C.brand }}
                  >
                    browse for it
                  </button>
                </>
              )}
            </div>
            <div className="mt-1 text-label" style={{ color: C.sub }}>
              Excel workbooks (.xlsx) only
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </div>
          <ErrorNote error={error} />
        </div>
      ) : (
        <div className="flex flex-col gap-5 font-display text-body">
          <div className="flex items-center gap-2" style={{ color: C.sub }}>
            <HugeiconsIcon icon={File01Icon} className="h-4 w-4" strokeWidth={1.8} />
            {prepared.fileName}
          </div>

          {prepared.otherYear && (
            <p style={{ color: C.amber }}>
              This template was made for {prepared.otherYear}. Its lines will go into the {fy.label}{' '}
              budget, which is the year on screen.
            </p>
          )}

          {/* The likeliest misreading of a budget, stated and flippable. */}
          {periodic && (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium" style={{ color: C.ink }}>
                Cost and income amounts in this file are
              </h3>
              <div className="w-full sm:w-80">
                <Select
                  aria-label="Whether cost and income amounts are for the year or each payment"
                  value={basis}
                  options={BASIS_OPTIONS}
                  onChange={(v) => setBasis(v as AmountBasis)}
                />
              </div>
              <p className="text-label" style={{ color: C.faint }}>
                For example, {periodic.name || 'the first line'} is {fmtMoney(periodic.amount)} in
                the file ({periodic.frequency}), so{' '}
                {fmtMoney(
                  basis === 'payment'
                    ? periodic.amount * periodsIn(periodic.frequency, fy, periodic.dueDate)
                    : periodic.amount,
                )}{' '}
                for the year.
              </p>
            </section>
          )}

          {openProgrammes.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium" style={{ color: C.ink }}>
                Which programme is this?
              </h3>
              {openProgrammes.map((r) => (
                <div
                  key={r.value}
                  className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]"
                >
                  <div className="min-w-0">
                    <div style={{ color: C.ink }}>
                      &ldquo;{r.value}&rdquo;{' '}
                      <span className="text-label" style={{ color: C.faint }}>
                        {r.rowCount} row{r.rowCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    {r.reason && (
                      <div className="text-label" style={{ color: C.faint }}>
                        Suggested: {r.reason}
                      </div>
                    )}
                  </div>
                  <Select
                    aria-label={`Programme for ${r.value}`}
                    placeholder="Choose a programme"
                    value={
                      programmeChoice[r.value] === null
                        ? LEAVE_OUT
                        : (programmeChoice[r.value] ?? '')
                    }
                    options={programmeOptions}
                    onChange={(v) =>
                      setProgrammeChoice((c) => {
                        const next = { ...c }
                        // The placeholder row clears the choice back to unanswered.
                        if (!v) delete next[r.value]
                        else next[r.value] = v === LEAVE_OUT ? null : v
                        return next
                      })
                    }
                  />
                </div>
              ))}
            </section>
          )}

          {untyped.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium" style={{ color: C.ink }}>
                Is this a cost or income?
              </h3>
              {untyped.map((r) => (
                <div
                  key={rowKey(r)}
                  className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]"
                >
                  <div className="min-w-0">
                    <div style={{ color: C.ink }}>
                      {r.name || 'Unnamed line'}{' '}
                      <span className="text-label" style={{ color: C.faint }}>
                        {rowPlace(r)}, {fmtMoney(r.amount)}
                      </span>
                    </div>
                    <div className="text-label" style={{ color: C.faint }}>
                      {r.typeWritten
                        ? `The file says "${r.typeWritten}", which is not Programme, Cost or Income.`
                        : 'The file does not say.'}
                    </div>
                  </div>
                  <Select
                    aria-label={`Type of ${r.name || rowPlace(r)}`}
                    placeholder="Choose"
                    value={
                      typeChoice[rowKey(r)] === null ? LEAVE_OUT : (typeChoice[rowKey(r)] ?? '')
                    }
                    options={TYPE_OPTIONS}
                    onChange={(v) =>
                      setTypeChoice((c) => {
                        const next = { ...c }
                        if (!v) delete next[rowKey(r)]
                        else next[rowKey(r)] = v === LEAVE_OUT ? null : (v as UploadType)
                        return next
                      })
                    }
                  />
                </div>
              ))}
            </section>
          )}

          {notes.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="font-medium" style={{ color: C.ink }}>
                Worth checking
              </h3>
              <ul className="flex flex-col gap-1 text-label">
                {notes.map((n, i) => (
                  <li key={`${rowKey(n)}-${i}`} style={{ color: n.leftOut ? C.danger : C.sub }}>
                    {rowPlace(n)}
                    {n.name ? ` (${n.name})` : ''}: {n.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {counts && (
            <section className="flex flex-col gap-1 border-t pt-4" style={{ borderColor: C.line }}>
              <p style={{ color: C.ink }}>
                Into the {fy.label} form: {counts.programmes} programme budget
                {counts.programmes === 1 ? '' : 's'}, {counts.costs} cost line
                {counts.costs === 1 ? '' : 's'} and {counts.income} income line
                {counts.income === 1 ? '' : 's'}.
              </p>
              <p className="text-label" style={{ color: C.sub }}>
                This replaces what is on the form now: a programme not in the file is left
                unbudgeted, and every cost and income line is replaced by the file&rsquo;s. Prior
                commitment figures and the contingency stay as they are. Nothing is saved until you
                press Save budget.
              </p>
            </section>
          )}
        </div>
      )}
    </Dialog>
  )
}
