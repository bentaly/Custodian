import { useMemo, useState } from 'react'
import { progressEoi } from '../../server/fns/eois'
import { updateApplicationStatus } from '../../server/fns/applications'
import { messageFor } from '../../lib/errors'
import { getRoundStatus, ROUND_STATUS_LABELS } from '../../lib/roundStatus'
import { Button, Dialog, Label, Select, TextLink } from '../ui'
import { C } from '../ui/tokens'
import type { listMyRounds } from '../../server/fns/rounds'
import { purposeAnswer } from '../../lib/eois/decode'
import { ShortlistFields, shortlistPayload, useShortlistFields } from '../sourcing/ShortlistFields'

// An expression of interest straight to the shortlist (route 3): the foundation has read
// enough and will fund it without a full application.
//
// An EOI is thinner than an application, so this asks for what the application cannot
// do without and the EOI may not have said: the same fields a partnership's "Progress to
// shortlist" asks (`ShortlistFields`), each prefilled from the EOI where it was
// recognised. The round is asked for unless a partnership already chose it.
//
// Two steps, as "Progress to shortlist" on a partnership: `progressEoi` makes the
// application, `updateApplicationStatus` shortlists it.

type Round = Awaited<ReturnType<typeof listMyRounds>>[number]

export function EoiProgressDialog({
  eoi,
  rounds,
  financialYearEndMonth,
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
    /** Their answers, for a grant purpose to start from when the form asked for one. */
    responses: Array<{ label: string; value: string }>
  }
  rounds: Round[]
  financialYearEndMonth: number | null
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
          roundProgramme: { ...rp, round },
        })),
      )
    // The EOI's own programme where it has one and that programme is in a round.
    const own = all.filter((o) => o.programmeId === eoi.programmeId)
    return own.length > 0 ? own : all
  }, [rounds, eoi.programmeId])

  const [roundProgrammeId, setRoundProgrammeId] = useState(
    eoi.partnershipRoundProgrammeId ?? options[0]?.value ?? '',
  )
  const chosen =
    rounds
      .flatMap((round) => round.roundProgrammes.map((rp) => ({ ...rp, round })))
      .find((rp) => rp.id === roundProgrammeId) ?? null

  const form = useShortlistFields({
    amount: eoi.amountIndicative ?? '',
    purpose: purposeAnswer(eoi.responses) ?? '',
    deliveryArea: '',
    proposedImpactQuantity: '',
    contactEmail: eoi.contactEmail ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stranded, setStranded] = useState<string | null>(null)

  const { valid: fieldsValid, data } = shortlistPayload(form, chosen?.grantDurationYears ?? null)
  const valid = roundProgrammeId !== '' && fieldsValid

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
          amount: data.amount,
          firstYearAmount: data.firstYearAmount,
          purpose: data.purpose,
          deliveryArea: data.deliveryArea,
          proposedImpactQuantity: data.proposedImpactQuantity,
          unrestrictedReserves: data.unrestrictedReserves,
          contactEmail: data.contactEmail,
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
      description={
        chosen
          ? `${eoi.organisationName} will be shortlisted for ${chosen.programme.name}, ${chosen.round.name}. Their answers to the expression of interest come with them.`
          : `${eoi.organisationName} will be shortlisted without a full application. Their answers to the expression of interest come with them.`
      }
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
          <ShortlistFields
            form={form}
            idPrefix="ep"
            context={{
              roundProgramme: chosen,
              financialYearEndMonth,
              // Nothing has screened an EOI yet: the register is read as it is shortlisted.
              income: null,
              incomeNote: 'Read from the charity register when it is shortlisted.',
            }}
          />
          <p className="font-display text-label" style={{ color: C.sub }}>
            When it is shortlisted, an application is created from these details and their answers.
            Custodian screens them against the registers and assesses it. Trustees vote on it like
            any other.
          </p>
        </div>
      )}
    </Dialog>
  )
}
