import { useState } from 'react'
import { setInstalmentsPaid } from '../../server/fns/applications'
import type { BankStatus } from '../../server/fns/finance'
import { Button, DateField, Dialog, Label } from '../ui'
import { fmtDate, fmtExact } from '../../lib/format'
import { messageFor } from '../../lib/errors'
import { localTodayIso } from '../../lib/schedule'

/** What the dialog needs of a Finance row: the payment and who it is for. */
export type PaymentToMark = {
  instalmentId: string
  organisationName: string
  instalmentNo: number | null
  instalmentCount: number
  amount: number
  dueDate: string | null
  bankStatus: BankStatus
}

/**
 * The confirm step for Finance's bulk "Mark as paid": the payment run recorded after it
 * was made in the bank.
 *
 * The date is asked for, not assumed. A run paid on Friday is often recorded on Monday,
 * and "today" would put every one of those payments on the wrong day in the ledger this
 * screen is reconciled against. It defaults to today because that is still the common
 * case, and cannot be in the future: a payment recorded before it happens is a promise.
 *
 * The payments are LISTED, not just counted. This is the moment someone compares what is
 * on screen with what their bank says went out, and "Mark 12 as paid" gives them nothing
 * to compare. A bad bank-detail verdict is stated but does not block: the money has
 * already moved by the time anyone is here, and refusing to record it would leave the
 * schedule claiming a payment is owed that has been made.
 */
export function MarkPaidDialog({
  payments,
  onClose,
  onDone,
}: {
  payments: PaymentToMark[]
  onClose: () => void
  /** After a successful write: clear the selection and re-read the list. */
  onDone: () => Promise<void>
}) {
  const today = localTodayIso()
  const [paidDate, setPaidDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const total = payments.reduce((s, p) => s + p.amount, 0)
  const bankIssues = payments.filter(
    (p) => p.bankStatus === 'invalid' || p.bankStatus === 'missing',
  )
  const n = payments.length
  const noun = n === 1 ? 'payment' : 'payments'

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await setInstalmentsPaid({
        data: { ids: payments.map((p) => p.instalmentId), paidDate },
      })
      await onDone()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={`Mark ${n} ${noun} as paid`}
      description="Record payments already made from your bank. Custodian does not move any money."
      onClose={onClose}
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={confirm}
            disabled={busy || !paidDate || paidDate > today}
          >
            {busy ? 'Recording…' : `Mark ${n} as paid`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-paid-date">Paid on</Label>
          <DateField
            id="bulk-paid-date"
            value={paidDate}
            onChange={setPaidDate}
            max={today}
            className="w-44"
          />
        </div>

        {bankIssues.length > 0 && (
          <p className="rounded-control bg-warning/10 px-3 py-2 text-label text-warning">
            {bankIssues.length === 1
              ? `${bankIssues[0]!.organisationName} has missing or invalid bank details.`
              : `${bankIssues.length} of these have missing or invalid bank details.`}{' '}
            Check the payment went to the right account before recording it.
          </p>
        )}

        <div className="flex flex-col rounded-control border border-grey-200">
          <ul className="max-h-72 divide-y divide-grey-200 overflow-y-auto">
            {payments.map((p) => (
              <li
                key={p.instalmentId}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-display text-body font-medium text-grey-900">
                    {p.organisationName}
                  </span>
                  <span className="text-label text-grey-500">
                    {p.instalmentNo !== null
                      ? `Payment ${p.instalmentNo} of ${p.instalmentCount}`
                      : 'Payment'}
                    {p.dueDate ? ` · Due ${fmtDate(p.dueDate)}` : ' · Date TBC'}
                  </span>
                </div>
                <span className="shrink-0 font-display text-body font-semibold text-grey-900">
                  {fmtExact(p.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-grey-200 px-3 py-2.5">
            <span className="font-display text-body font-medium text-grey-500">Total</span>
            <span className="font-display text-body font-semibold text-grey-900">
              {fmtExact(total)}
            </span>
          </div>
        </div>

        {error && <p className="font-display text-body text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
