import { useState } from 'react'
import { progressPartnership } from '../../server/fns/partnerships'
import { updateApplicationStatus } from '../../server/fns/applications'
import { messageFor } from '../../lib/errors'
import { Button, Dialog, Label, MoneyInput, TextLink } from '../ui'
import { C } from '../ui/tokens'

// "Progress to shortlist": the partner the foundation wants to fund without sending them
// through a form. No email goes anywhere.
//
// No round to pick: the partnership was logged against one, and that is the budget the
// grant is drawn from. The value is confirmed because it becomes the amount the round's
// budget is drawn on.
//
// **Two steps, and the dialog says which one failed.** `progressPartnership` makes the
// application; `updateApplicationStatus` shortlists it, because that function owns the
// round-budget ceiling and nothing else should. If the second is refused (the round is
// full and the foundation enforces its budget), the application is still there and the
// dialog links to it rather than leaving a record nobody can find.

export function ProgressDialog({
  partnership,
  where,
  onClose,
  onDone,
}: {
  partnership: { id: string; organisationName: string; amountSought: string | null }
  /** "Youth Fund, 2026/27 round": what the dialog is putting it into. */
  where: string
  onClose: () => void
  onDone: (applicationId: string) => void
}) {
  const [amount, setAmount] = useState(partnership.amountSought ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Set when the application was made but could not be shortlisted. */
  const [stranded, setStranded] = useState<string | null>(null)

  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0

  async function handleConfirm() {
    if (busy || !valid) return
    setBusy(true)
    setError('')
    let applicationId: string | null = null
    try {
      const made = await progressPartnership({ data: { id: partnership.id, amount: value } })
      applicationId = made.applicationId
      await updateApplicationStatus({ data: { id: applicationId, status: 'shortlisted' } })
      onDone(applicationId)
    } catch (err) {
      setError(messageFor(err))
      if (applicationId) setStranded(applicationId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title="Shortlist"
      description={`${partnership.organisationName} will be shortlisted for ${where}. No form is sent and nobody is emailed.`}
      onClose={onClose}
      busy={busy}
      footer={
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="font-display text-body text-danger">
              {stranded ? 'The application was created, but it could not be shortlisted. ' : ''}
              {error}{' '}
              {stranded && (
                <TextLink to="/applications/$applicationId" params={{ applicationId: stranded }}>
                  Open the application
                </TextLink>
              )}
            </p>
          )}
          <div className="flex justify-end">
            {stranded ? (
              <Button variant="secondary" onClick={() => onDone(stranded)}>
                Close
              </Button>
            ) : (
              <Button disabled={busy || !valid} onClick={handleConfirm}>
                {busy ? 'Adding to the shortlist…' : 'Add to the shortlist'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="pg-amount">Grant value proposed</Label>
          <MoneyInput
            id="pg-amount"
            label="Grant value proposed"
            value={amount}
            onChange={setAmount}
          />
          <p className="mt-1.5 font-display text-label" style={{ color: C.sub }}>
            This is the amount the round's budget is drawn on.
          </p>
        </div>
        <p className="font-display text-label" style={{ color: C.sub }}>
          This creates an application from what you have logged: the organisation, the proposed
          purpose, value and impact, the delivery area, the due diligence result and the assessment.
          Trustees vote on it like any other. Bank details are added in Finance once it is awarded.
        </p>
      </div>
    </Dialog>
  )
}
