import { useMemo, useState } from 'react'
import { lookupOrganisation, savePartnership } from '../../server/fns/partnerships'
import { messageFor } from '../../lib/errors'
import { fmtAmount, fmtDate } from '../../lib/format'
import { impactUnitLabel } from '../../lib/impactUnits'
import { getRoundStatus, ROUND_STATUS_LABELS } from '../../lib/roundStatus'
import { PARTNERSHIP_STATUS_META } from '../../lib/partnerships/status'
import { Button, Dialog, Input, Label, MoneyInput, Select, TextLink, Textarea } from '../ui'
import { C } from '../ui/tokens'
import { AreaInput } from '../applications/edit/AreaInput'

// Log a prospective partner, or edit one — the whole record in one dialog, the shape
// `RoundDialog` and `ProgrammeDialog` established. A modal rather than a page because a
// prospect is logged from the list, and the person typing wants to be back on it.
//
// **It asks only for what one of the four routes to an application needs** (2026-10-04):
//
//   1. partnership → straight to the shortlist
//   2. partnership → invited to apply → their application
//   3. EOI → straight to the shortlist
//   4. EOI → their application → shortlist
//
// On 2 and 4 the applicant's own form supplies everything again, so a field here earns
// its place only by feeding the screening (due diligence and the AI assessment) or by
// being something route 1's application cannot do without. So: a registration number
// (screening, and how we know we have met them before), the name, the round and
// programme (what the assessment is judged against, and where route 1 puts the grant),
// the value and purpose (the assessment's whole "ask", and route 1's amount and purpose),
// the delivery area and impact (the assessment's need and proportionality, and route 1's
// place on the Insights map), and an email (every invitation, and route 1's award letter).
// The organisation's type, its address, a contact's name and our own reference fed
// nothing and went.
//
// **It starts with the number.** Custodian looks the organisation up, the register's own
// name fills the name field, and anything the foundation already knows about them (in
// the pipeline, turned down, funded before) is said before a second record is made.

export type PartnershipDraft = {
  id?: string
  organisationName: string
  charityNumber: string
  companyNumber: string
  source: string
  roundProgrammeId: string
  deliveryArea: string
  contactEmail: string
  amountSought: string
  proposedPurpose: string
  proposedImpactQuantity: string
  note: string
}

export const emptyPartnershipDraft = (): PartnershipDraft => ({
  organisationName: '',
  charityNumber: '',
  companyNumber: '',
  source: '',
  roundProgrammeId: '',
  deliveryArea: '',
  contactEmail: '',
  amountSought: '',
  proposedPurpose: '',
  proposedImpactQuantity: '',
  note: '',
})

/** The rounds the dialog offers, each with the programmes funded in it. */
export type PartnershipRound = {
  id: string
  name: string
  openedAt: Date | string | null
  closedAt: Date | string | null
  roundProgrammes: Array<{
    id: string
    programme: { id: string; name: string; impactUnit: string; impactUnitLabel: string | null }
  }>
}

/**
 * The ways a relationship starts, offered as a list because the value of the column is
 * comparing one against another — a foundation whose whole pipeline says "Trustee
 * referral" has learned something about its own reach. Free text would give them twelve
 * spellings of it and no answer.
 */
const SOURCES = [
  'Trustee referral',
  'Advisor introduction',
  'Prior grantee',
  'Sector event',
  'Direct approach',
  'Funder referral',
]

const FORM_ID = 'partnership-form'

export function PartnershipDialog({
  open,
  draft,
  rounds,
  onClose,
  onSaved,
}: {
  open: boolean
  /** `undefined` while closed; an `id`-less draft logs a new one, one with an `id` edits. */
  draft: PartnershipDraft | undefined
  /** The foundation's rounds. Closed ones are offered too, last. */
  rounds: PartnershipRound[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  // Keyed by the record being edited, so opening a different row resets every field.
  return open && draft ? (
    <PartnershipDialogForm
      key={draft.id ?? 'new'}
      draft={draft}
      rounds={rounds}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null
}

function PartnershipDialogForm({
  draft,
  rounds,
  onClose,
  onSaved,
}: {
  draft: PartnershipDraft
  rounds: PartnershipRound[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = draft.id !== undefined
  const [form, setForm] = useState(draft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [found, setFound] = useState<Awaited<ReturnType<typeof lookupOrganisation>> | null>(null)

  const set = <K extends keyof PartnershipDraft>(key: K, value: PartnershipDraft[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Every round-programme pairing, open and upcoming rounds first: a prospect is usually
  // being lined up for a round that has not happened yet.
  const options = useMemo(() => {
    const order = { open: 0, upcoming: 1, closed: 2 } as const
    return rounds
      .map((round) => ({ round, status: getRoundStatus(round) }))
      .sort((a, b) => order[a.status] - order[b.status])
      .flatMap(({ round, status }) =>
        round.roundProgrammes.map((rp) => ({
          value: rp.id,
          label: `${round.name} · ${rp.programme.name} (${ROUND_STATUS_LABELS[status].toLowerCase()})`,
          programme: rp.programme,
        })),
      )
  }, [rounds])
  const programme = options.find((o) => o.value === form.roundProgrammeId)?.programme
  const unit = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel).toLowerCase()

  const hasNumber = !!(form.charityNumber.trim() || form.companyNumber.trim())
  const complete =
    hasNumber &&
    form.organisationName.trim() !== '' &&
    form.roundProgrammeId !== '' &&
    Number(form.amountSought) > 0 &&
    form.proposedPurpose.trim() !== ''

  async function handleLookup() {
    if (looking) return
    setLooking(true)
    setLookupError('')
    try {
      const result = await lookupOrganisation({
        data: {
          charityNumber: form.charityNumber.trim() || null,
          companyNumber: form.companyNumber.trim() || null,
        },
      })
      setFound(result)
      setForm((f) => ({
        ...f,
        // The register's name, unless somebody has already typed one: theirs is a
        // decision ("we call them the Hub"), ours is a suggestion.
        organisationName: f.organisationName.trim() || result.registeredName || '',
        // Funded before is the one source the app can see for itself.
        source: f.source || (result.history.awards.length > 0 ? 'Prior grantee' : ''),
      }))
    } catch (err) {
      setLookupError(messageFor(err))
    } finally {
      setLooking(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !complete) return
    setSaving(true)
    setError('')
    try {
      const blank = (v: string) => (v.trim() ? v.trim() : null)
      const impact = form.proposedImpactQuantity.trim()
        ? Number(form.proposedImpactQuantity.replace(/,/g, ''))
        : null
      const { id } = await savePartnership({
        data: {
          id: draft.id,
          organisationName: form.organisationName.trim(),
          charityNumber: blank(form.charityNumber),
          companyNumber: blank(form.companyNumber),
          source: blank(form.source),
          roundProgrammeId: form.roundProgrammeId,
          deliveryArea: blank(form.deliveryArea),
          contactEmail: blank(form.contactEmail),
          amountSought: Number(form.amountSought),
          proposedPurpose: form.proposedPurpose.trim(),
          proposedImpactQuantity:
            impact !== null && Number.isFinite(impact) && impact >= 0 ? impact : null,
          // Only on create: the timeline's first line. An edit writes no event — see
          // `savePartnership` on why a changelog would bury the introduction.
          note: editing ? null : blank(form.note),
        },
      })
      onSaved(id)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title={editing ? 'Edit partner' : 'Log a partner'}
      description={
        editing
          ? 'The organisation, and the grant you have in mind for them.'
          : 'An organisation you are approaching, before there is an application. Start with their charity or company number.'
      }
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <div className="flex flex-col gap-3">
          {error && <p className="font-display text-body text-danger">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-label" style={{ color: C.sub }}>
              {complete ? '' : 'A number, the round, a value and a purpose are needed.'}
            </span>
            <Button type="submit" form={FORM_ID} disabled={saving || !complete}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Log partner'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* The registration numbers come FIRST: they are what Custodian can look up, and
            looking up is what saves typing the rest and stops a duplicate being made. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="p-charity">Charity number</Label>
            <Input
              id="p-charity"
              value={form.charityNumber}
              onChange={(e) => set('charityNumber', e.target.value)}
              placeholder="Enter charity number"
              autoFocus={!editing}
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-company">Company number</Label>
            <Input
              id="p-company"
              value={form.companyNumber}
              onChange={(e) => set('companyNumber', e.target.value)}
              placeholder="Enter company number"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={looking || !hasNumber}
            onClick={handleLookup}
          >
            {looking ? 'Looking up…' : 'Look up'}
          </Button>
        </div>
        {lookupError && <p className="font-display text-label text-danger">{lookupError}</p>}
        {found && <LookupResult found={found} editingId={draft.id} />}

        <div>
          <Label htmlFor="p-name">Organisation</Label>
          <Input
            id="p-name"
            value={form.organisationName}
            onChange={(e) => set('organisationName', e.target.value)}
            placeholder="Enter organisation name"
            required
          />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-[2]">
            <Label htmlFor="p-round">Round and programme</Label>
            <Select
              id="p-round"
              options={options}
              value={form.roundProgrammeId || undefined}
              onChange={(v) => set('roundProgrammeId', v)}
              placeholder="Select round and programme"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-source">Source of the relationship</Label>
            <Select
              id="p-source"
              options={SOURCES.map((s) => ({ value: s, label: s }))}
              value={form.source || undefined}
              onChange={(v) => set('source', v)}
              placeholder="Select source"
            />
          </div>
        </div>
        {options.length === 0 && (
          <p className="-mt-2 font-display text-label" style={{ color: C.warning }}>
            There are no rounds yet. A partner is logged against the round you would fund them from,
            so create one under <TextLink to="/rounds">Rounds</TextLink> first (an upcoming round is
            fine).
          </p>
        )}

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            {/* "Proposed" on purpose, every time it is printed. Nothing in Finance, the
                budget or any meter reads this column: a value somebody proposes is not
                money committed (the money rule, CLAUDE.md). */}
            <Label htmlFor="p-amount">Grant value proposed</Label>
            <MoneyInput
              id="p-amount"
              label="Grant value proposed"
              value={form.amountSought}
              onChange={(v) => set('amountSought', v)}
              placeholder="Enter amount"
            />
          </div>
          <div className="flex-1">
            {/* The whole grant's impact, not a year of it: the same figure an
                application states as its proposed impact. */}
            <Label htmlFor="p-impact">Proposed impact</Label>
            <Input
              id="p-impact"
              inputMode="numeric"
              value={form.proposedImpactQuantity}
              onChange={(e) => set('proposedImpactQuantity', e.target.value)}
              placeholder={`Enter number of ${unit}`}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="p-purpose">Grant purpose proposed</Label>
          <Textarea
            id="p-purpose"
            rows={3}
            value={form.proposedPurpose}
            onChange={(e) => set('proposedPurpose', e.target.value)}
            placeholder="Enter what the grant would pay for"
          />
          <p className="mt-1.5 font-display text-label text-grey-500">
            Custodian assesses them against your giving strategy and the programme on this.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="p-area">Delivery area</Label>
            <AreaInput
              id="p-area"
              value={form.deliveryArea}
              onChange={(v) => set('deliveryArea', v)}
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-email">Contact email</Label>
            <Input
              id="p-email"
              type="email"
              value={form.contactEmail}
              onChange={(e) => set('contactEmail', e.target.value)}
              placeholder="Enter contact email"
            />
          </div>
        </div>

        {!editing && (
          <div>
            <Label htmlFor="p-note">Notes</Label>
            <Textarea
              id="p-note"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Enter how the relationship came about"
            />
            <p className="mt-1.5 font-display text-label text-grey-500">
              The first line of the relationship history. Everything that happens after this is
              added to it.
            </p>
          </div>
        )}
      </form>
    </Dialog>
  )
}

/**
 * What the lookup found: who the number belongs to, and whether the foundation has met
 * them before. The second half is the reason to look before logging. A repeat grantee is
 * still logged as a NEW partner (each ask has its own value, purpose and round), but the
 * history behind them is shown here rather than left to memory.
 */
function LookupResult({
  found,
  editingId,
}: {
  found: Awaited<ReturnType<typeof lookupOrganisation>>
  editingId: string | undefined
}) {
  const others = found.history.partnerships.filter((p) => p.id !== editingId)
  const awards = found.history.awards
  return (
    <div
      className="flex flex-col gap-2 rounded-control border p-3"
      style={{ borderColor: C.line, backgroundColor: C.wash }}
    >
      {found.found ? (
        <p className="font-display text-body" style={{ color: C.ink }}>
          <span className="font-medium">{found.registeredName}</span>
          <span style={{ color: C.sub }}>
            {[
              found.charityType,
              found.latestIncome != null ? `income ${fmtAmount(found.latestIncome)}` : null,
              found.registeredSince ? `registered ${fmtDate(found.registeredSince)}` : null,
            ]
              .filter(Boolean)
              .map((part) => ` · ${part}`)
              .join('')}
          </span>
        </p>
      ) : (
        <p className="font-display text-body" style={{ color: C.sub }}>
          The register did not return a name for that number. You can still log them by name, and
          due diligence will say what it found.
        </p>
      )}
      {others.length > 0 && (
        <p className="font-display text-label" style={{ color: C.warning }}>
          Already logged:{' '}
          {others.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <TextLink to="/partnerships/$partnershipId" params={{ partnershipId: p.id }}>
                {p.organisationName}
              </TextLink>{' '}
              ({p.archivedAt ? 'archived' : PARTNERSHIP_STATUS_META[p.status].label.toLowerCase()},{' '}
              {fmtDate(p.createdAt)})
            </span>
          ))}
        </p>
      )}
      {awards.length > 0 && (
        <p className="font-display text-label" style={{ color: C.sub }}>
          {awards.length} prior {awards.length === 1 ? 'grant' : 'grants'}:{' '}
          {awards
            .map(
              (a) =>
                `${fmtAmount(a.amountAwarded)}, ${new Date(a.decidedAt).getFullYear()}, ${a.programmeName}${a.status === 'cancelled' ? ' (cancelled)' : ''}`,
            )
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
