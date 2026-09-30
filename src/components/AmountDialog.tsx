import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { Label, Textarea } from './ui/fields'
import { MoneyInput } from './ui/MoneyInput'
import { C } from './ui/tokens'
import { fmtMoney } from '../lib/format'
import { amendmentDelta } from '../lib/amendedAmount'
import { suggestFirstYearAmount } from '../lib/multiYear'

export type AmountChange = {
  /** The proposed amount, or `null` for "the amount requested". */
  amount: number | null
  /** `undefined` = the person did not touch this year's share (the server keeps a stated
   *  one that still fits); `null` = the suggestion; a number = what they typed. */
  firstYearAmount: number | null | undefined
  /** A reason, appended to the comment the change posts in the discussion. */
  note: string
  /** Whether anything differs from what is stored, so a caller can skip the write. */
  changed: boolean
}

/**
 * "How much would we award, and how much of it falls in this year?" — the one dialog for
 * both figures, opened when shortlisting (where the round budget is a ceiling), from the
 * shortlist card and from the application screen.
 *
 * ## Why one dialog
 *
 * The first-year share is a part of the amount, so the two are one decision: shrink the
 * grant and a stated share may no longer fit inside it. Two dialogs let somebody set one
 * without seeing the other. See `src/lib/amendedAmount.ts` for the rules, which the server
 * applies again.
 *
 * ## What it asks and when
 *
 * The amount always. This year's share only where it can differ from the amount (a
 * multi-year round, or a share somebody already stated): for a single-year grant the two
 * are the same number and asking twice is noise. A reason only once the amount has
 * changed, since that is what posts a comment. The remaining round budget whenever there
 * is one, because the question somebody changing a figure is asking is "does it fit".
 */
export function AmountDialog({
  open,
  onClose,
  onConfirm,
  mode,
  organisationName,
  amountRequested,
  amountAmended,
  firstYear,
  firstYearIsSuggested,
  durationYears,
  financialYearLabel,
  budgetRemaining,
  enforced,
  votesCast,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (change: AmountChange) => Promise<unknown>
  /** Shortlisting now, or changing a figure on an application already in hand. */
  mode: 'shortlist' | 'edit'
  organisationName: string
  amountRequested: number
  /** What is proposed now, or null while it is the amount requested. */
  amountAmended: number | null
  /** This year's share in use now (stated, else suggested), of the current amount. */
  firstYear: number
  firstYearIsSuggested: boolean
  durationYears: number | null
  financialYearLabel: string
  /** This year's cash left in the round for THIS application, or null to say nothing. */
  budgetRemaining: number | null
  /** Whether this foundation treats the round budget as a hard ceiling. */
  enforced: boolean
  /** Votes the current board has cast on it. They stand; the dialog says so. */
  votesCast: number
}) {
  const current = amountAmended ?? amountRequested
  const [amount, setAmount] = useState(String(current))
  const [share, setShare] = useState(String(firstYear))
  const [shareTouched, setShareTouched] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seeded on every open, so a figure typed and backed out of is gone next time. Keyed
  // on `open` rather than a fresh mount so the Dialog's own focus handling stays in charge.
  useEffect(() => {
    if (open) {
      setAmount(String(current))
      setShare(String(firstYear))
      setShareTouched(false)
      setNote('')
      setError(null)
    }
  }, [open, current, firstYear])

  const parsedAmount = amount.trim() === '' ? null : Number(amount)
  const amountInvalid = parsedAmount === null || !Number.isFinite(parsedAmount) || parsedAmount <= 0
  const effective = amountInvalid ? current : parsedAmount!
  const amountChanged = Math.abs(effective - current) >= 0.005
  const differsFromAsk = Math.abs(effective - amountRequested) >= 0.005

  const suggested = suggestFirstYearAmount(effective, durationYears)
  // Until somebody types in it, the share follows the amount exactly as the server will:
  // a suggestion is re-suggested, and a stated share is kept unless it no longer fits.
  const untouchedShare =
    firstYearIsSuggested || firstYear > effective + 0.005 ? suggested : firstYear
  const parsedShare = share.trim() === '' ? null : Number(share)
  const shareInvalid =
    shareTouched && parsedShare !== null && (!Number.isFinite(parsedShare) || parsedShare < 0)
  const shareTooBig = shareTouched && parsedShare !== null && parsedShare > effective + 0.005
  const drawdown =
    shareTouched && parsedShare !== null && !shareInvalid ? parsedShare : untouchedShare
  const shareIsSuggestion = Math.abs(drawdown - suggested) < 0.005

  const asksShare =
    (durationYears !== null && durationYears > 1) || !firstYearIsSuggested || shareTouched
  const overBudget = budgetRemaining !== null && drawdown > budgetRemaining + 0.005
  // Mirrors the server: shortlisting over an enforced ceiling is refused; on an
  // application already drawing on it, only a change that RAISES the draw is.
  const blockedByBudget =
    enforced && overBudget && (mode === 'shortlist' || drawdown > firstYear + 0.005)
  const blocked = amountInvalid || shareInvalid || shareTooBig || blockedByBudget

  async function confirm() {
    if (blocked) return
    setError(null)
    setBusy(true)
    try {
      await onConfirm({
        amount: differsFromAsk ? effective : null,
        firstYearAmount: shareTouched ? (shareIsSuggestion ? null : drawdown) : undefined,
        note,
        changed: amountChanged || (shareTouched && Math.abs(drawdown - firstYear) >= 0.005),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const years = durationYears && durationYears > 1 ? ` over ${durationYears} years` : ''

  return (
    <Dialog
      open={open}
      busy={busy}
      size="sm"
      title={mode === 'shortlist' ? 'Shortlist application' : 'Amount to award'}
      description={
        <>
          How much would you award {organisationName}? They asked for {fmtMoney(amountRequested)}
          {years}.
        </>
      }
      onClose={busy ? () => {} : onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || blocked}>
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
          <Label htmlFor="amount-to-award">Amount to award</Label>
          <MoneyInput
            id="amount-to-award"
            label="Amount to award"
            value={amount}
            onChange={setAmount}
            disabled={busy}
          />
          {/* The ask stays on screen beside any other figure, so a proposal reads as a
              choice against it rather than a correction of something that vanished. */}
          <p className="font-display text-label" style={{ color: C.sub }}>
            {differsFromAsk && !amountInvalid ? (
              <>
                {amendmentDelta(effective, amountRequested)} on the {fmtMoney(amountRequested)}{' '}
                requested.{' '}
                <button
                  type="button"
                  onClick={() => setAmount(String(amountRequested))}
                  disabled={busy}
                  className="underline"
                  style={{ color: C.brand }}
                >
                  Use the amount requested
                </button>
              </>
            ) : (
              'The amount requested. It can be more or less than they asked for.'
            )}
          </p>
        </div>

        {asksShare && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount-this-year">Of which in {financialYearLabel}</Label>
            <MoneyInput
              id="amount-this-year"
              label={`Amount falling in ${financialYearLabel}`}
              // Untouched, the box shows the share the server would keep, derived in the
              // same render as the amount rather than copied into state after it.
              value={shareTouched ? share : String(untouchedShare)}
              onChange={(v) => {
                setShareTouched(true)
                setShare(v)
              }}
              disabled={busy}
            />
            <p className="font-display text-label" style={{ color: C.sub }}>
              A round budget counts what is paid this financial year. Suggested{' '}
              {fmtMoney(suggested)}
              {durationYears && durationYears > 1 ? ' (amount ÷ years)' : ''}.
              {!shareIsSuggestion && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => {
                      setShareTouched(true)
                      setShare(String(suggested))
                    }}
                    disabled={busy}
                    className="underline"
                    style={{ color: C.brand }}
                  >
                    Use this
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        {amountChanged && !amountInvalid && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount-note">Reason (optional)</Label>
            <Textarea
              id="amount-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              placeholder="Added to the discussion with the change"
            />
          </div>
        )}

        {budgetRemaining !== null && (
          <dl className="flex flex-col gap-1.5 font-display text-label" style={{ color: C.sub }}>
            <div className="flex items-center justify-between gap-3">
              <dt>Left in this round for it</dt>
              <dd className="tabular-nums" style={{ color: overBudget ? C.danger : C.ink }}>
                {fmtMoney(Math.max(0, budgetRemaining))}
              </dd>
            </div>
            {asksShare && (
              <div className="flex items-center justify-between gap-3">
                <dt>It would draw in {financialYearLabel}</dt>
                <dd className="tabular-nums" style={{ color: C.ink }}>
                  {fmtMoney(drawdown)}
                </dd>
              </div>
            )}
          </dl>
        )}

        {/* Votes are never reset. Said before saving, so nobody learns it from the card. */}
        {amountChanged && votesCast > 0 && (
          <p className="font-display text-label" style={{ color: C.amber }}>
            {votesCast === 1 ? '1 vote has' : `${votesCast} votes have`} been cast on{' '}
            {fmtMoney(current)}. {votesCast === 1 ? 'It stays' : 'They stay'} as{' '}
            {votesCast === 1 ? 'it is' : 'they are'}, and the shortlist will say{' '}
            {votesCast === 1 ? 'it was' : 'they were'} cast before this change.
          </p>
        )}
        {amountInvalid && amount.trim() !== '' && (
          <p className="font-display text-label" style={{ color: C.danger }}>
            Enter an amount above £0. To fund nothing, decline the application.
          </p>
        )}
        {shareTooBig && (
          <p className="font-display text-label" style={{ color: C.danger }}>
            That is more than the whole grant.
          </p>
        )}
        {/* Over budget is said in words, and only blocks where the foundation asked for a
            ceiling. With the ceiling off it is information a board wants, not a refusal. */}
        {!shareTooBig && overBudget && (
          <p
            className="font-display text-label"
            style={{ color: blockedByBudget ? C.danger : C.amber }}
          >
            {blockedByBudget
              ? mode === 'shortlist'
                ? 'This is more than the round has left, so it cannot be shortlisted at this amount.'
                : 'This is more than the round has left. Lower the amount, or the round budget.'
              : 'This takes the round over its budget, which is allowed. The shortlist will say by how much.'}
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
