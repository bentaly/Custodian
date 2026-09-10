import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { Label } from './ui/fields'
import { MoneyInput } from './ui/MoneyInput'
import { C } from './ui/tokens'
import { fmtMoney } from '../lib/format'

/**
 * "How much of this falls in this financial year?" — asked when an application is
 * shortlisted, and editable afterwards.
 *
 * ## Why it is asked at all
 *
 * A round's budget counts THIS YEAR'S CASH, not the whole commitment
 * (`src/lib/multiYear.ts`), so a multi-year grant draws only its first year's share. At
 * shortlist there is no payment schedule to divide — the start date, the instalment count
 * and the cadence are all set later in award set-up — so the figure cannot be derived.
 * The ask divided by the round-programme's grant duration is right for an ordinary annual
 * grant and is offered as the suggestion; a £48,000 grant paid every four months over
 * sixteen months draws £36,000 in its first year and that division says £24,000, which
 * only the person shortlisting it knows.
 *
 * ## Why it is a dialog and not a field on the page
 *
 * Shortlisting is one click on a header button, and the figure is only ever wanted in the
 * same breath. A field sitting on the screen waiting to be filled before the button works
 * would put an edit box in front of every ordinary single-year grant for no reason; a
 * dialog asks only the people who are shortlisting, offers them the answer, and takes
 * Enter for "yes that's right". The suggestion is pre-selected on open for the same
 * reason — the common case is one keystroke.
 *
 * The remaining budget is shown whenever there is one, because the one thing somebody
 * correcting this figure wants to know is whether the corrected number still fits.
 */
export function FirstYearDialog({
  open,
  onClose,
  onConfirm,
  mode,
  organisationName,
  amountRequested,
  suggested,
  current,
  durationYears,
  financialYearLabel,
  budgetRemaining,
  enforced,
}: {
  open: boolean
  onClose: () => void
  /** `null` means "accept the suggestion", which stores nothing. */
  onConfirm: (amount: number | null) => Promise<unknown>
  /** Shortlisting for the first time, or correcting a figure already in the meter. */
  mode: 'shortlist' | 'edit'
  organisationName: string
  amountRequested: number
  suggested: number
  /** The figure in use now — equals `suggested` while nobody has overridden it. */
  current: number
  durationYears: number | null
  financialYearLabel: string
  /** This year's cash left in the round-programme's budget, or null if it has none set. */
  budgetRemaining: number | null
  /** Whether this foundation treats that budget as a hard ceiling. */
  enforced: boolean
}) {
  const [value, setValue] = useState(String(current))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed every time the dialog opens, so a figure someone typed and then backed out
  // of is not still sitting there next time. Keyed on `open` rather than mounted fresh so
  // the Dialog's own focus handling stays in charge.
  useEffect(() => {
    if (open) {
      setValue(String(current))
      setError(null)
    }
  }, [open, current])

  const parsed = value.trim() === '' ? null : Number(value)
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0)
  const tooMuch = parsed !== null && parsed > amountRequested
  // An empty field means "the whole ask falls in this year" only if that is what they
  // typed; blank is treated as the suggestion, which is the thing the field opened with.
  const effective = parsed === null || invalid ? suggested : parsed
  const isSuggestion = Math.abs(effective - suggested) < 0.005
  const overBudget = budgetRemaining !== null && effective > budgetRemaining

  async function confirm() {
    if (invalid || tooMuch) return
    setError(null)
    setBusy(true)
    try {
      // A figure that matches the suggestion is stored as NULL, not as itself: the
      // suggestion should keep tracking the duration if someone later corrects that,
      // and "I agreed with you" is not the same fact as "I decided this number".
      await onConfirm(isSuggestion ? null : effective)
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
      busy={busy}
      size="sm"
      title={mode === 'shortlist' ? 'Shortlist application' : 'Amount in this year'}
      description={
        <>
          A round budget counts what has to be paid this financial year. How much of{' '}
          {organisationName}&rsquo;s {fmtMoney(amountRequested)} falls in {financialYearLabel}?
        </>
      }
      onClose={busy ? () => {} : onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || invalid || tooMuch}>
            {busy ? '…' : mode === 'shortlist' ? 'Shortlist' : 'Save'}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void confirm()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="first-year-amount">Amount in {financialYearLabel}</Label>
          <MoneyInput
            id="first-year-amount"
            label={`Amount falling in ${financialYearLabel}`}
            value={value}
            onChange={setValue}
            disabled={busy}
          />
        </div>

        {/* What we suggested and why, always visible rather than only when overridden —
            an override has to read as a deliberate choice against a figure still on
            screen, not as a correction to something that has disappeared. */}
        <dl className="flex flex-col gap-1.5 font-display text-label" style={{ color: C.sub }}>
          <div className="flex items-center justify-between gap-3">
            <dt>Full ask</dt>
            <dd className="tabular-nums" style={{ color: C.ink }}>
              {fmtMoney(amountRequested)}
              {durationYears && durationYears > 1 ? ` over ${durationYears} years` : ''}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Suggested{durationYears && durationYears > 1 ? ' (ask ÷ years)' : ''}</dt>
            <dd className="tabular-nums">
              {fmtMoney(suggested)}
              {!isSuggestion && (
                <button
                  type="button"
                  onClick={() => setValue(String(suggested))}
                  disabled={busy}
                  className="ml-2 underline"
                  style={{ color: C.brand }}
                >
                  use this
                </button>
              )}
            </dd>
          </div>
          {budgetRemaining !== null && (
            <div className="flex items-center justify-between gap-3">
              <dt>Left in this round</dt>
              <dd className="tabular-nums" style={{ color: overBudget ? C.danger : C.ink }}>
                {fmtMoney(budgetRemaining)}
              </dd>
            </div>
          )}
        </dl>

        {tooMuch && (
          <p className="font-display text-label" style={{ color: C.danger }}>
            That is more than the application is asking for.
          </p>
        )}
        {/* Over budget is said in words, and only blocks where the foundation asked for a
            ceiling. With the ceiling off this is information a board wants, not a refusal
            — most foundations shortlist more than they can fund on purpose. */}
        {!tooMuch && overBudget && (
          <p className="font-display text-label" style={{ color: enforced ? C.danger : C.amber }}>
            {enforced
              ? 'This is more than the round has left, so it cannot be shortlisted.'
              : 'This takes the round over its budget, which is allowed — the shortlist will say by how much.'}
          </p>
        )}
        {error && (
          <p className="font-display text-label" style={{ color: C.danger }}>
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
