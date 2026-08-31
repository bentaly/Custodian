import { useState } from 'react'
import { recordBankBalance } from '../../server/fns/budget'
import { Button, DateField, Dialog, ErrorNote, Input, Label, MoneyInput, TOKENS as C } from '../ui'
import { messageFor } from '../../lib/errors'
import { fmtDate, fmtMoney } from '../../lib/format'
import { todayIso } from '../../lib/schedule'

/**
 * Record a reading of the grant-making bank balance.
 *
 * Deliberately small. A ring-fenced giving account has no day-to-day spend on it, so
 * this is opened a handful of times a year — an amount, the date it was true, and an
 * optional note is the whole job, and anything more would be ceremony around three
 * fields.
 *
 * **The as-at date is a field, not `now()`.** Somebody entering Monday's closing figure
 * on Thursday must be able to say which day it belongs to, or the staleness warning on
 * the panel is wrong in both directions — and the previous reading's date is shown here
 * so a correction to the same day is an obvious thing to do rather than a puzzle.
 *
 * Each save is a new row; nothing is overwritten. The figure on screen is one a board may
 * act on, so who said it and when it was true are part of the number.
 */
export function BankBalanceDialog({
  open,
  previous,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The reading being superseded, shown for context. Null on the very first one. */
  previous: { amount: number; asAtDate: string } | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [asAtDate, setAsAtDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parsed = parseFloat(amount)
  const valid = Number.isFinite(parsed) && parsed >= 0 && !!asAtDate

  function reset() {
    setAmount('')
    setAsAtDate(todayIso())
    setNote('')
    setError('')
  }

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      await recordBankBalance({
        data: { amount: parsed, asAtDate, note: note.trim() || undefined },
      })
      await onSaved()
      reset()
      onClose()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="Update bank balance"
      description="The balance of the account you make grants from. Custodian shows it against what you have committed."
      busy={saving}
      size="sm"
      onClose={() => {
        reset()
        onClose()
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !valid}>
            {saving ? 'Saving…' : 'Save balance'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="balance-amount">Balance</Label>
          <MoneyInput
            id="balance-amount"
            value={amount}
            label="Bank balance"
            placeholder="0.00"
            onChange={setAmount}
          />
        </div>

        <div>
          <Label htmlFor="balance-date">As at</Label>
          <DateField
            id="balance-date"
            value={asAtDate}
            onChange={setAsAtDate}
            // A balance cannot be observed in advance. The server refuses one too — this
            // just stops the picker offering days that would be rejected.
            max={todayIso()}
            aria-label="Date this balance was true"
          />
        </div>

        <div>
          <Label htmlFor="balance-note">Note (optional)</Label>
          <Input
            id="balance-note"
            value={note}
            maxLength={200}
            placeholder="e.g. after the March payment run"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <ErrorNote error={error} />

        {previous && (
          <p className="font-display text-label" style={{ color: C.faint }}>
            Replaces {fmtMoney(previous.amount)} as at {fmtDate(previous.asAtDate)}. Earlier
            readings are kept.
          </p>
        )}
      </div>
    </Dialog>
  )
}
