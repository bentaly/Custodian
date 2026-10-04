import { useMemo, useState } from 'react'
import { progressEoi } from '../../server/fns/eois'
import { updateApplicationStatus } from '../../server/fns/applications'
import { messageFor } from '../../lib/errors'
import { getRoundStatus, ROUND_STATUS_LABELS } from '../../lib/roundStatus'
import { Button, Dialog, Input, Label, MoneyInput, Select, TextLink, Textarea } from '../ui'
import { C } from '../ui/tokens'
import { AreaInput } from '../applications/edit/AreaInput'
import type { PartnershipRound } from '../partnerships/PartnershipDialog'

// An expression of interest straight to the shortlist (route 3): the foundation has read
// enough and will fund it without a full application.
//
// An EOI is thinner than an application, so this asks for what the application cannot
// do without and the EOI may not have said: the amount, what it is for, where, and an
// address to send the award letter to. Each is prefilled from the EOI where it was
// recognised. The round is asked for unless a partnership already chose it.
//
// Two steps, as "Progress to shortlist" on a partnership: `progressEoi` makes the
// application, `updateApplicationStatus` shortlists it.

export function EoiProgressDialog({
  eoi,
  rounds,
  onClose,
  onDone,
}: {
  eoi: {
    id: string
    organisationName: string
    programmeId: string | null
    amountIndicative: string | null
    contactEmail: string | null
    /** The partnership's own round-programme, when a sourced partner sent this. */
    partnershipRoundProgrammeId: string | null
  }
  rounds: PartnershipRound[]
  onClose: () => void
  onDone: (applicationId: string) => void
}) {
  const options = useMemo(() => {
    const order = { open: 0, upcoming: 1, closed: 2 } as const
    const all = rounds
      .map((round) => ({ round, status: getRoundStatus(round) }))
      .sort((a, b) => order[a.status] - order[b.status])
      .flatMap(({ round, status }) =>
        round.roundProgrammes.map((rp) => ({
          value: rp.id,
          programmeId: rp.programme.id,
          label: `${round.name} · ${rp.programme.name} (${ROUND_STATUS_LABELS[status].toLowerCase()})`,
        })),
      )
    // The EOI's own programme where it has one and that programme is in a round.
    const own = all.filter((o) => o.programmeId === eoi.programmeId)
    return own.length > 0 ? own : all
  }, [rounds, eoi.programmeId])

  const [roundProgrammeId, setRoundProgrammeId] = useState(
    eoi.partnershipRoundProgrammeId ?? options[0]?.value ?? '',
  )
  const [amount, setAmount] = useState(eoi.amountIndicative ?? '')
  const [purpose, setPurpose] = useState('')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [email, setEmail] = useState(eoi.contactEmail ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stranded, setStranded] = useState<string | null>(null)

  const value = Number(amount)
  const valid =
    roundProgrammeId !== '' && Number.isFinite(value) && value > 0 && purpose.trim() !== ''

  async function handleConfirm() {
    if (busy || !valid) return
    setBusy(true)
    setError('')
    let applicationId: string | null = null
    try {
      const made = await progressEoi({
        data: {
          id: eoi.id,
          roundProgrammeId,
          amount: value,
          purpose: purpose.trim(),
          deliveryArea: deliveryArea.trim() || null,
          contactEmail: email.trim() || null,
        },
      })
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
      description={`${eoi.organisationName} goes straight to the shortlist without a full application. Their answers to the expression of interest come with them.`}
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
      {options.length === 0 ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          There is no round to put this in yet. Create a round with a programme in it first, under{' '}
          <TextLink to="/rounds">Rounds</TextLink>.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {!eoi.partnershipRoundProgrammeId && (
            <div>
              <Label htmlFor="ep-round">Round and programme</Label>
              <Select
                id="ep-round"
                options={options}
                value={roundProgrammeId || undefined}
                onChange={setRoundProgrammeId}
              />
            </div>
          )}
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex-1">
              <Label htmlFor="ep-amount">Grant value proposed</Label>
              <MoneyInput
                id="ep-amount"
                label="Grant value proposed"
                value={amount}
                onChange={setAmount}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="ep-area">Delivery area</Label>
              <AreaInput id="ep-area" value={deliveryArea} onChange={setDeliveryArea} />
            </div>
          </div>
          <div>
            <Label htmlFor="ep-purpose">Grant purpose</Label>
            <Textarea
              id="ep-purpose"
              rows={3}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="What the grant would pay for, in a sentence or two"
            />
          </div>
          <div>
            <Label htmlFor="ep-email">Contact email</Label>
            <Input
              id="ep-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@organisation.org.uk"
            />
            <p className="mt-1.5 font-display text-label" style={{ color: C.sub }}>
              Where the award letter goes. Custodian screens them against the registers and assesses
              their answers once it is on the shortlist.
            </p>
          </div>
        </div>
      )}
    </Dialog>
  )
}
