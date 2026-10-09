import { useState } from 'react'
import {
  ShortlistFields,
  shortlistPayload,
  useShortlistFields,
  type ShortlistContext,
} from '../sourcing/ShortlistFields'
import { progressPartnership } from '../../server/fns/partnerships'
import { updateApplicationStatus } from '../../server/fns/applications'
import { messageFor } from '../../lib/errors'
import { Button, Dialog, TextLink } from '../ui'
import { C } from '../ui/tokens'

// "Progress to shortlist": the partner the foundation wants to fund without sending them
// through a form. No email goes anywhere.
//
// No round to pick: the partnership was logged against one, and that is the budget the
// grant is drawn from. What the application needs is confirmed in `ShortlistFields`,
// prefilled from what was logged: the value and this year's share are what the round's
// budget is drawn on, and the rest is what the application screen would otherwise show
// as never captured.
//
// **Two steps, and the dialog says which one failed.** `progressPartnership` makes the
// application; `updateApplicationStatus` shortlists it, because that function owns the
// round-budget ceiling and nothing else should. If the second is refused (the round is
// full and the foundation enforces its budget), the application is still there and the
// dialog links to it rather than leaving a record nobody can find.

export function ProgressDialog({
  partnership,
  where,
  context,
  onClose,
  onDone,
}: {
  partnership: {
    id: string
    organisationName: string
    amountSought: string | null
    proposedPurpose: string | null
    deliveryArea: string | null
    proposedImpactQuantity: string | null
    contactEmail: string | null
  }
  /** "Youth Fund, 2026/27 round": what the dialog is putting it into. */
  where: string
  /** The round-programme, the year end and the register's income (`ShortlistFields`). */
  context: ShortlistContext
  onClose: () => void
  onDone: (applicationId: string) => void
}) {
  // Everything prefilled from what was logged; anything corrected here is written back
  // to the partnership as well (`progressPartnership`).
  const form = useShortlistFields({
    amount: partnership.amountSought ?? '',
    purpose: partnership.proposedPurpose ?? '',
    deliveryArea: partnership.deliveryArea ?? '',
    proposedImpactQuantity: partnership.proposedImpactQuantity ?? '',
    contactEmail: partnership.contactEmail ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Set when the application was made but could not be shortlisted. */
  const [stranded, setStranded] = useState<string | null>(null)

  const { valid, data } = shortlistPayload(form, context.roundProgramme?.grantDurationYears ?? null)

  async function handleConfirm() {
    if (busy || !valid) return
    setBusy(true)
    setError('')
    let applicationId: string | null = null
    try {
      const made = await progressPartnership({ data: { id: partnership.id, ...data } })
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
      title="Progress to shortlist"
      description={`${partnership.organisationName} will be shortlisted for ${where}.`}
      onClose={onClose}
      busy={busy}
      size="lg"
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
        <ShortlistFields form={form} context={context} idPrefix="pg" />
        <p className="font-display text-label" style={{ color: C.sub }}>
          When a partner is shortlisted, an application is created from these details, with the due
          diligence result and the assessment. No form is sent and nobody is emailed. Trustees vote
          on it like any other. Bank details are added in Finance once it is awarded.
        </p>
      </div>
    </Dialog>
  )
}
