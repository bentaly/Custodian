import { useMemo, useState } from 'react'
import { savePartnership } from '../../server/fns/partnerships'
import { messageFor } from '../../lib/errors'
import { Button, Dialog, Input, Label, MoneyInput, Select, Textarea } from '../ui'
import { TagInput } from '../TagInput'

// Log a prospective partner, or edit one — the whole record in one dialog, the shape
// `RoundDialog` and `ProgrammeDialog` established.
//
// This is the one screen in the app where a MODAL is the right answer rather than a
// route, and the reason is the gesture it has to survive: a prospect is logged in the
// thirty seconds after a phone call, from the list, and the person typing wants to be
// back on the list when they are done. A page they had to navigate to and out of would
// lose the list behind them and, with it, the answer to "have we already got these
// people?" — which is exactly what they are checking.
//
// It is also why only the NAME is required. Everything else can be filled in later on
// the record; a form that insisted on a charity number first would not be filled in at
// all, and the relationship would go back to living in somebody's inbox.

export type PartnershipDraft = {
  id?: string
  organisationName: string
  reference: string
  organisationType: string
  location: string
  charityNumber: string
  companyNumber: string
  source: string
  programmeId: string
  tags: string[]
  contactName: string
  contactEmail: string
  amountSought: string
  note: string
}

export const emptyPartnershipDraft = (): PartnershipDraft => ({
  organisationName: '',
  reference: '',
  organisationType: '',
  location: '',
  charityNumber: '',
  companyNumber: '',
  source: '',
  programmeId: '',
  tags: [],
  contactName: '',
  contactEmail: '',
  amountSought: '',
  note: '',
})

/**
 * The ways a relationship starts, offered as a list because the value of the column is
 * comparing one against another — a foundation whose whole pipeline says "Trustee
 * referral" has learned something about its own reach. Free text would give them twelve
 * spellings of it and no answer. "Other" is deliberately absent: an unlisted route in
 * is worth typing, so the field takes a value outside the list too.
 */
const SOURCES = [
  'Trustee referral',
  'Advisor introduction',
  'Prior grantee',
  'Sector event',
  'Direct approach',
  'Funder referral',
  'Expression of interest',
]

const ORGANISATION_TYPES = [
  'Registered charity',
  'CIO',
  'CIC',
  'Community group',
  'Social enterprise',
  'Company limited by guarantee',
]

const FORM_ID = 'partnership-form'

export function PartnershipDialog({
  open,
  draft,
  programmes,
  themeSuggestions,
  onClose,
  onSaved,
}: {
  open: boolean
  /** `undefined` while closed; an `id`-less draft logs a new one, one with an `id` edits. */
  draft: PartnershipDraft | undefined
  programmes: Array<{ id: string; name: string }>
  themeSuggestions: string[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  // Keyed by the record being edited, so opening a different row resets every field.
  return open && draft ? (
    <PartnershipDialogForm
      key={draft.id ?? 'new'}
      draft={draft}
      programmes={programmes}
      themeSuggestions={themeSuggestions}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null
}

function PartnershipDialogForm({
  draft,
  programmes,
  themeSuggestions,
  onClose,
  onSaved,
}: {
  draft: PartnershipDraft
  programmes: Array<{ id: string; name: string }>
  themeSuggestions: string[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = draft.id !== undefined
  const [form, setForm] = useState(draft)
  const [pendingTag, setPendingTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof PartnershipDraft>(key: K, value: PartnershipDraft[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const programmeOptions = useMemo(
    () => programmes.map((p) => ({ value: p.id, label: p.name })),
    [programmes],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    // A theme typed but never committed with Enter is data the user believes they have
    // entered — saving over it silently loses it, so the form refuses instead (the same
    // guard `TagInput` exists to make possible).
    if (pendingTag.trim()) {
      setError('Press Enter to add the theme you have typed, or clear it.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const blank = (v: string) => (v.trim() ? v.trim() : null)
      const amount = form.amountSought.trim() ? Number(form.amountSought) : null
      const { id } = await savePartnership({
        data: {
          id: draft.id,
          organisationName: form.organisationName.trim(),
          reference: blank(form.reference),
          organisationType: blank(form.organisationType),
          location: blank(form.location),
          charityNumber: blank(form.charityNumber),
          companyNumber: blank(form.companyNumber),
          source: blank(form.source),
          programmeId: form.programmeId || null,
          tags: form.tags,
          contactName: blank(form.contactName),
          contactEmail: blank(form.contactEmail),
          amountSought: amount !== null && Number.isFinite(amount) ? amount : null,
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
          ? 'Details of the organisation and how you know them.'
          : 'An organisation you are talking to, before there is an application. A name is enough to start.'
      }
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <div className="flex flex-col gap-3">
          {error && <p className="font-display text-body text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" form={FORM_ID} disabled={saving || !form.organisationName.trim()}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Log partner'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="p-name">Organisation</Label>
          <Input
            id="p-name"
            value={form.organisationName}
            onChange={(e) => set('organisationName', e.target.value)}
            placeholder="Who are they?"
            required
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="p-type">Type</Label>
            <Select
              id="p-type"
              options={ORGANISATION_TYPES.map((t) => ({ value: t, label: t }))}
              value={form.organisationType || undefined}
              onChange={(v) => set('organisationType', v)}
              placeholder="Not known yet"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-location">Where they are</Label>
            <Input
              id="p-location"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="Leeds"
            />
          </div>
        </div>

        {/* The two registration numbers sit together and early, because they are what
            makes the screening button on the record work — and screening a prospect
            before anyone spends an afternoon on them is most of the point of logging
            one. Both optional: plenty of organisations worth talking to have neither. */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="p-charity">Charity number</Label>
            <Input
              id="p-charity"
              value={form.charityNumber}
              onChange={(e) => set('charityNumber', e.target.value)}
              placeholder="1180432"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-company">Company number</Label>
            <Input
              id="p-company"
              value={form.companyNumber}
              onChange={(e) => set('companyNumber', e.target.value)}
              placeholder="08234567"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="p-source">How you know them</Label>
            <Select
              id="p-source"
              options={SOURCES.map((s) => ({ value: s, label: s }))}
              value={form.source || undefined}
              onChange={(v) => set('source', v)}
              placeholder="Select…"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-programme">Programme</Label>
            <Select
              id="p-programme"
              options={programmeOptions}
              value={form.programmeId || undefined}
              onChange={(v) => set('programmeId', v)}
              placeholder="Not decided yet"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="p-tags">Themes</Label>
          <TagInput
            id="p-tags"
            value={form.tags}
            onChange={(tags) => set('tags', tags)}
            suggestions={themeSuggestions}
            onPendingChange={setPendingTag}
          />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="p-contact">Contact</Label>
            <Input
              id="p-contact"
              value={form.contactName}
              onChange={(e) => set('contactName', e.target.value)}
              placeholder="Who you speak to"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="p-email">Contact email</Label>
            <Input
              id="p-email"
              type="email"
              value={form.contactEmail}
              onChange={(e) => set('contactEmail', e.target.value)}
              placeholder="name@organisation.org.uk"
            />
          </div>
        </div>

        <div className="sm:w-1/2 sm:pr-2">
          {/* Labelled "indicative" on purpose. Nothing in Finance, the budget or any
              meter reads this column — it is what somebody said over coffee, and the
              money rule (CLAUDE.md) says a conversation is not a commitment. It feeds
              the "grant as a share of income" due diligence check and nothing else. */}
          <Label htmlFor="p-amount">Indicative ask</Label>
          <MoneyInput
            id="p-amount"
            label="Indicative ask"
            value={form.amountSought}
            onChange={(v) => set('amountSought', v)}
            placeholder="Not discussed"
          />
        </div>

        {!editing && (
          <div>
            <Label htmlFor="p-note">How this came about</Label>
            <Textarea
              id="p-note"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Introduced by James Hartley at the May board dinner…"
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
