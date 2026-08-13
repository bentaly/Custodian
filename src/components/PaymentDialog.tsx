import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, PencilEdit02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { setInstalmentPaid, updateInstalment } from '../server/fns/applications'
import { updateGrantBankDetails } from '../server/fns/finance'
import type { getFinanceGrant, BankStatus } from '../server/fns/finance'
import { Badge, Button, DateField, Dialog, Input, TextLink, cn } from './ui'
import { C } from './ui/tokens'
import { fmtDate, fmtMoney } from '../lib/format'
import { messageFor } from '../lib/errors'

// The payment panel (Figma 672:25886) — one grant's money in a dialog over the Finance
// list, replacing the old `/finance/$awardId` detail screen. Three sections, in the
// order a payment run needs them: is this grant ready to pay, what is the schedule, and
// where would the money go.
//
// Two sections are editable, and both work the same way (Figma 672:26733): one Edit
// control in the card's top-right corner turns every field in that card into an input at
// once, and becomes Save + Cancel. That shape is what let the per-row kebab menus go —
// and with them the fixed slot after each figure that was holding the numbers out of
// line. A column of money should read as a column of money.
//
// The one departure from the comp: bank details never say "Correct", and never a bare
// "Valid" either. All we run is a level-1 modulus check, which proves the sort code and
// account number are a well-formed pair and NOTHING about who owns the account. Either
// word would be read as "we checked this is the grantee", which is Confirmation of Payee
// — a paid check we do not make. So the badge says "Valid format": same size, same
// place, same green, and it claims only what was actually checked. The failed state
// (Figma 823:653) says the same thing the other way round: the panel states what failed
// AND what the check was ever able to prove, so "Invalid" is never read as "not their
// account".

export type FinanceGrant = Awaited<ReturnType<typeof getFinanceGrant>>
type Instalment = FinanceGrant['instalments'][number]

export function PaymentDialog({
  grant,
  onClose,
  onChanged,
}: {
  grant: FinanceGrant
  onClose: () => void
  /** Re-reads the grant and the list behind it after a schedule edit. */
  onChanged: () => Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busyId !== null}
      title="Payment details"
      description={
        // `Dialog` draws its description at 12px, which is right where it is a line of
        // explanatory copy. Here it is the grant's identity — who this money is for —
        // so this one dialog states it at 14px (Figma 823:118), in one flat grey with
        // no emphasised half: the comp gives the whole line Gray/500.
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
          <span>{grant.organisationName}</span>
          {grant.programmeName && (
            <>
              <span aria-hidden>·</span>
              <span>{grant.programmeName}</span>
            </>
          )}
          <span aria-hidden>·</span>
          {/* The one way out of this dialog into the decision behind it: the terms, the
              letter and the reporting schedule all live on the award record. */}
          <TextLink to="/awards/$awardId" params={{ awardId: grant.id }}>
            View Award →
          </TextLink>
        </span>
      }
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busyId !== null}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="font-display text-body text-danger">{error}</p>}
        <Lifecycle grant={grant} />
        <Schedule
          grant={grant}
          busyId={busyId}
          setBusyId={setBusyId}
          onError={setError}
          onChanged={onChanged}
        />
        <BankDetails
          grant={grant}
          busyId={busyId}
          setBusyId={setBusyId}
          onError={setError}
          onChanged={onChanged}
        />
      </div>
    </Dialog>
  )
}

// ─── Section shell ───────────────────────────────────────────────────────────

function Section({
  title,
  aside,
  action,
  children,
}: {
  title: string
  /** Sits beside the title — a status badge, a count. Part of the heading. */
  aside?: React.ReactNode
  /** The card's top-right corner: Edit, or Save + Cancel while editing. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-control border border-grey-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-display text-title font-medium text-grey-900">{title}</h3>
          {aside}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * Edit / Save / Cancel for a card that edits as a whole. Save leads on the way out
 * because it is the action; on the way in there is only Edit.
 */
function EditControls({
  editing,
  busy,
  canSave = true,
  onEdit,
  onSave,
  onCancel,
}: {
  editing: boolean
  busy: boolean
  /** False while the card holds something the server would reject — Save is the gate. */
  canSave?: boolean
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
}) {
  if (!editing) {
    return (
      <Button variant="text" size="xs" icon={PencilEdit02Icon} onClick={onEdit}>
        Edit
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-4">
      <Button variant="text" size="xs" onClick={onCancel} disabled={busy} style={{ color: C.sub }}>
        Cancel
      </Button>
      {/* `tinted` rather than `secondary`: Save wants a box, but it is also the one
          committing action in the card, and the app's outlined-and-green is what that
          looks like everywhere else. */}
      <Button
        variant="tinted"
        size="xs"
        icon={Tick02Icon}
        iconPosition="right"
        onClick={onSave}
        disabled={busy || !canSave}
      >
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

/** The label/value row every section is built from. */
function Row({
  label,
  value,
  valueColour,
  icon,
  action,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  valueColour?: string
  icon?: React.ReactNode
  /** Sits BEFORE the value — a reveal toggle, a Mark paid link. */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="font-display text-body font-medium text-grey-500">{label}</span>
      </div>
      {/* The value is the last thing in the row and never shares its slot, so every
          figure in a card — instalments and the total they add up to — sits on one
          right edge without anything reserving space beside it. */}
      <div className="flex shrink-0 items-center gap-3">
        {action}
        <span
          className="whitespace-nowrap text-right font-display text-body font-medium"
          style={{ color: valueColour ?? C.ink }}
        >
          {value}
        </span>
      </div>
    </div>
  )
}

// ─── Grant lifecycle ─────────────────────────────────────────────────────────

/**
 * Where this grant has got to, every step read off data we actually hold (Figma
 * 672:26670). The comp's "Compliance guidance issued" is deliberately absent: no column
 * records it, and in the comp it carries the same date as the award letter above it, so
 * what it names is an open question rather than a row we can fill.
 *
 * `alert` is separate from `warn` because a payment that is merely outstanding and one
 * that is late are not the same news on a screen used to decide today's payment run.
 */
type StepState = 'done' | 'warn' | 'alert' | 'pending'

const BANK_STEP: Record<BankStatus, { state: StepState; text: string }> = {
  valid: { state: 'done', text: 'Valid format' },
  invalid: { state: 'warn', text: 'Modulus check failed' },
  unchecked: { state: 'warn', text: 'Not checkable' },
  missing: { state: 'warn', text: 'Not provided' },
}

/** The comp's last row: the one payment this panel exists to get out of the door. */
function paymentDueStep(grant: FinanceGrant): { state: StepState; text: string } {
  if (grant.awardStatus === 'cancelled') return { state: 'pending', text: 'Grant cancelled' }
  if (grant.instalmentCount === 0) return { state: 'warn', text: 'No schedule' }
  const next = grant.nextPayment
  if (!next) return { state: 'done', text: 'All paid' }
  if (!next.dueDate) return { state: 'warn', text: 'Date TBC' }
  return {
    state: grant.status === 'overdue' ? 'alert' : 'warn',
    text: fmtDate(next.dueDate),
  }
}

function Lifecycle({ grant }: { grant: FinanceGrant }) {
  const letter = grant.letter
  const letterStep: { state: StepState; text: string } =
    letter?.status === 'sent'
      ? { state: 'done', text: fmtDate(letter.sentAt) }
      : letter?.status === 'failed'
        ? { state: 'warn', text: 'Send failed' }
        : { state: 'pending', text: 'Not sent' }

  const steps: Array<{ name: string; state: StepState; text: string }> = [
    { name: 'Award approved', state: 'done', text: fmtDate(grant.decisionAt) },
    // "Award letter", never "Award notification" as the comp has it — the template, the
    // settings page and the award record all call it a letter, and one screen using a
    // second name for it is how a foundation ends up asking which is which.
    { name: 'Award letter sent', ...letterStep },
    { name: 'Bank details', ...BANK_STEP[grant.bank.status] },
    { name: 'Payment due', ...paymentDueStep(grant) },
  ]

  return (
    <Section title="Grant lifecycle">
      {steps.map((s) => (
        <Row
          key={s.name}
          label={s.name}
          value={s.text}
          valueColour={STEP_COLOUR[s.state]}
          icon={<StepIcon state={s.state} />}
        />
      ))}
    </Section>
  )
}

const STEP_COLOUR: Record<StepState, string> = {
  done: C.ink,
  warn: C.warning,
  alert: C.danger,
  pending: C.faint,
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return <HugeiconsIcon icon={Tick02Icon} size={16} color={C.success} strokeWidth={2} />
  }
  if (state === 'warn' || state === 'alert') {
    return (
      <HugeiconsIcon
        icon={Alert02Icon}
        size={16}
        color={state === 'alert' ? C.danger : C.warning}
        strokeWidth={2}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="mx-[5px] size-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: C.muted }}
    />
  )
}

// ─── Payment schedule ────────────────────────────────────────────────────────

const PAY_BADGE: Record<string, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-success/10 text-success' },
  overdue: { label: 'Overdue', className: 'bg-danger/10 text-danger' },
  next: { label: 'Due next', className: 'bg-warning/10 text-warning' },
  due_soon: { label: 'Due soon', className: 'bg-warning/10 text-warning' },
  upcoming: { label: 'Upcoming', className: 'bg-grey-100 text-grey-400' },
  tbc: { label: 'Date TBC', className: 'bg-grey-100 text-grey-400' },
}

/** One instalment's editable half, as strings — what is in the boxes, not what is saved. */
type Draft = { amount: string; dueDate: string }

function draftsFrom(instalments: Instalment[]): Record<string, Draft> {
  return Object.fromEntries(
    instalments.map((i) => [i.id, { amount: String(i.amount), dueDate: i.dueDate ?? '' }]),
  )
}

function Schedule({
  grant,
  busyId,
  setBusyId,
  onError,
  onChanged,
}: {
  grant: FinanceGrant
  busyId: string | null
  setBusyId: (id: string | null) => void
  onError: (message: string) => void
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  const busy = busyId !== null
  const saving = busyId === 'schedule'

  // "Due next" is a position in the queue, not a status: the earliest unpaid instalment
  // that has not already gone past its date.
  const nextId = grant.instalments.find((i) => !i.paidDate && i.status !== 'overdue')?.id ?? null

  // While editing, the total and the reconciliation warning below follow what is in the
  // boxes rather than what is stored — so an admin fixing a split watches the shortfall
  // close as they type, instead of saving and hoping.
  const amountOf = (i: Instalment) => (editing ? Number(drafts[i.id]?.amount ?? NaN) : i.amount)
  const draftTotal = grant.instalments.reduce((s, i) => {
    const n = amountOf(i)
    return s + (Number.isFinite(n) ? n : 0)
  }, 0)
  const unallocated = editing ? grant.committed - draftTotal : grant.unallocated

  // `updateInstalment` takes a positive amount, so an empty or zero box is not something
  // to report back after a failed save — it just holds Save shut.
  const canSave = grant.instalments.every((i) => {
    const n = Number(drafts[i.id]?.amount)
    return Number.isFinite(n) && n > 0
  })

  async function run(id: string, work: () => Promise<unknown>) {
    if (busy) return
    setBusyId(id)
    onError('')
    try {
      await work()
      await onChanged()
      return true
    } catch (err) {
      onError(messageFor(err))
      // Saving the card is several writes, so a failure can be a PARTIAL one. Re-read
      // rather than leave the pre-save figures on screen under a message saying it went
      // wrong — "nothing saved" is the one conclusion that must not be guessed at.
      await onChanged().catch(() => {})
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function save() {
    // Only the rows that actually moved. A schedule of eight instalments where one date
    // slipped should be one write, not eight.
    const changed = grant.instalments.filter((i) => {
      const d = drafts[i.id]
      return d && (Number(d.amount) !== i.amount || (d.dueDate || null) !== i.dueDate)
    })
    if (changed.length === 0) {
      setEditing(false)
      return
    }
    const ok = await run('schedule', () =>
      Promise.all(
        changed.map((i) =>
          updateInstalment({
            data: {
              id: i.id,
              amount: Number(drafts[i.id]!.amount),
              dueDate: drafts[i.id]!.dueDate || null,
            },
          }),
        ),
      ),
    )
    if (ok) setEditing(false)
  }

  return (
    <Section
      title="Payment schedule"

      action={
        grant.canEdit && grant.instalments.length > 0 ? (
          <EditControls
            editing={editing}
            busy={saving}
            canSave={canSave}
            onEdit={() => {
              setDrafts(draftsFrom(grant.instalments))
              setEditing(true)
            }}
            onSave={save}
            onCancel={() => {
              setEditing(false)
              onError('')
            }}
          />
        ) : undefined
      }
    >
      {/* The plan and the promise are separate numbers, and they drift: an award can be
          committed at £60k with only £40k of instalments written down. */}
      {Math.round(unallocated) !== 0 && (
        <p className="rounded-control bg-warning/10 px-3 py-2 text-label text-warning">
          {unallocated > 0
            ? `${fmtMoney(unallocated)} of the committed amount is not on the schedule yet.`
            : `The schedule is ${fmtMoney(-unallocated)} more than the committed amount.`}
        </p>
      )}

      {grant.instalments.length === 0 ? (
        <p className="text-body text-grey-400">
          No instalments recorded. Add a schedule on the{' '}
          <TextLink to="/awards/$awardId" params={{ awardId: grant.id }}>
            award record
          </TextLink>
          .
        </p>
      ) : (
        <>
          {editing && (
            // Outside edit mode a paid row shows the date it was PAID; the box below it
            // holds the date it was DUE. Naming the columns is what stops that swap
            // reading as the panel having lost a date.
            <div className="flex items-center gap-1 text-label text-grey-400">
              <span>Due date</span>
              <span className="w-32 text-right">Amount</span>
            </div>
          )}

          {grant.instalments.map((inst) => {
            if (editing) {
              const draft = drafts[inst.id] ?? { amount: '', dueDate: '' }
              return (
                <div key={inst.id} className="flex items-center justify-between gap-3">
                  {/* Both at the app's 40px control height. `cn` is a plain join, not a
                      tailwind-merge, so a size class passed in here would lose to the
                      one already on the component — the sizes have to agree by choice. */}
                  <DateField
                    value={draft.dueDate}
                    onChange={(dueDate) =>
                      setDrafts((d) => ({ ...d, [inst.id]: { ...draft, dueDate } }))
                    }
                    className="w-44"
                    aria-label={`Instalment ${inst.instalmentNo} due date`}
                  />
                  <Input
                    type="number"
                    min="0"
                    value={draft.amount}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [inst.id]: { ...draft, amount: e.target.value } }))
                    }
                    className="w-32 text-right"
                    aria-label={`Instalment ${inst.instalmentNo} amount`}
                  />
                </div>
              )
            }

            const key = inst.paidDate
              ? 'paid'
              : inst.id === nextId && inst.dueDate
                ? 'next'
                : inst.status
            const badge = PAY_BADGE[key] ?? PAY_BADGE.upcoming!
            const rowBusy = busyId === inst.id

            return (
              <Row
                key={inst.id}
                label={
                  <span className="flex items-center gap-2">
                    <span className="whitespace-nowrap">
                      {inst.paidDate ? fmtDate(inst.paidDate) : fmtDate(inst.dueDate)}
                    </span>
                    <Badge size="sm" className={badge.className}>
                      {badge.label}
                    </Badge>
                  </span>
                }
                className={rowBusy ? 'opacity-60' : undefined}
                value={<span className="font-semibold text-brand">{fmtMoney(inst.amount)}</span>}
                action={
                  grant.canEdit ? (
                    // Marking paid is the routine act, so it sits on the row rather than
                    // behind a menu. Un-marking is named by its effect, not "Undo": this
                    // row may have been paid eight months ago, and clearing it says the
                    // money never went out — not that a recent click was a mistake. It
                    // wears the warning colour for the same reason.
                    <Button
                      variant="text"
                      size="xs"
                      disabled={busy}
                      style={inst.paidDate ? { color: C.warning } : undefined}
                      onClick={() =>
                        run(inst.id, () =>
                          setInstalmentPaid({ data: { id: inst.id, paid: !inst.paidDate } }),
                        )
                      }
                    >
                      {inst.paidDate ? 'Mark as unpaid' : 'Mark paid'}
                    </Button>
                  ) : undefined
                }
              />
            )
          })}

          <div className="border-t border-grey-200 pt-3">
            <Row
              label="Total"
              value={
                <span className="font-semibold text-brand">
                  {fmtMoney(editing ? draftTotal : grant.scheduledTotal)}
                </span>
              }
            />
          </div>
        </>
      )}
    </Section>
  )
}

// ─── Bank details ────────────────────────────────────────────────────────────

const BANK_BADGE: Record<BankStatus, { label: string; className: string }> = {
  valid: { label: 'Valid format', className: 'bg-success/10 text-success' },
  invalid: { label: 'Invalid', className: 'bg-danger/10 text-danger' },
  unchecked: { label: 'Not checkable', className: 'bg-warning/10 text-warning' },
  missing: { label: 'Not provided', className: 'bg-grey-100 text-grey-500' },
}

// The whole sentence per status, not a fragment with a shared tail appended: the tail
// ("The check confirms…") is only true where a check actually RAN, and appending it to
// all four produced "No bank details on file. The check confirms the numbers are a
// valid pair" — a card claiming to have checked what it does not hold.
const BANK_DETAIL_TEXT: Record<BankStatus, string> = {
  valid:
    'Sort code and account number pass the modulus check. The check confirms the numbers are a valid pair, not who owns the account.',
  invalid:
    'Fails the modulus check — likely a typo. The check confirms if the numbers are a valid pair, not who owns the account.',
  unchecked: 'Not in a checkable format, so the modulus check has not run.',
  missing: 'No bank details on file.',
}

/**
 * The tinted panel a problem announces itself in (Figma 823:653) — one tone per status,
 * taken from the same table the badge is coloured by, so a card can never wear a red
 * pill over an amber panel.
 *
 * `valid` has no panel on purpose: a pass is not news, and it stays the quiet grey line
 * the card has always ended on. That asymmetry is the point — a problem is stated
 * BEFORE the four numbers, because it is the reason to read them; a pass is a footnote
 * after them.
 */
const BANK_TONE: Record<BankStatus, { panel: string; figure: string } | null> = {
  valid: null,
  invalid: { panel: 'bg-danger/10 text-danger', figure: C.danger },
  // The panel and the figure it points at are one tone, so a card cannot state two
  // severities about the same pair of numbers.
  unchecked: { panel: 'bg-warning/10 text-warning', figure: C.warning },
  missing: { panel: 'bg-grey-100 text-grey-500', figure: C.sub },
}

/**
 * Which figure the check is complaining about. The comp puts the red on the NUMBER as
 * well as in the panel, and both halves are load-bearing: the panel alone leaves an
 * admin comparing four figures against a bank letter to work out which one it means.
 *
 * A failed modulus condemns the PAIR — either digit could be the typo — so both are
 * marked rather than picking one at random. Only a malformed input names a single field.
 */
function flaggedFields(status: BankStatus, reason: string | null) {
  if (status === 'valid' || status === 'missing') return { sortCode: false, accountNumber: false }
  if (reason === 'malformed_sort_code') return { sortCode: true, accountNumber: false }
  if (reason === 'malformed_account_number') return { sortCode: false, accountNumber: true }
  return { sortCode: true, accountNumber: true }
}

/** The alert the panel and the flagged figures share, at the comp's 14px. */
function BankAlertIcon({ className }: { className?: string }) {
  // The comp draws a circle; this is the app's triangle (`Alert02Icon`), the same glyph
  // the Grant lifecycle rows two sections up already use for exactly this warning. One
  // dialog running two alert shapes is worse than one differing from the comp.
  return <HugeiconsIcon icon={Alert02Icon} size={14} strokeWidth={1.8} className={className} />
}

/** `402918` → `40-29-18`; anything unexpected is shown as given. */
function fmtSortCode(value: string | null) {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  return digits.length === 6
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
    : value
}

type BankDraft = {
  accountName: string
  bankName: string
  sortCode: string
  accountNumber: string
}

function BankDetails({
  grant,
  busyId,
  setBusyId,
  onError,
  onChanged,
}: {
  grant: FinanceGrant
  busyId: string | null
  setBusyId: (id: string | null) => void
  onError: (message: string) => void
  onChanged: () => Promise<void>
}) {
  const [revealed, setRevealed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<BankDraft>({
    accountName: '',
    bankName: '',
    sortCode: '',
    accountNumber: '',
  })

  const { bank } = grant
  const badge = BANK_BADGE[bank.status]
  const tone = BANK_TONE[bank.status]
  const flagged = flaggedFields(bank.status, bank.reason)
  const saving = busyId === 'bank'

  function field(key: keyof BankDraft, label: string, placeholder: string) {
    return (
      <div key={key} className="flex items-center justify-between gap-3">
        <label htmlFor={`bank-${key}`} className="font-display text-body font-medium text-grey-500">
          {label}
        </label>
        <Input
          id={`bank-${key}`}
          value={draft[key]}
          placeholder={placeholder}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          className="w-52"
        />
      </div>
    )
  }

  async function save() {
    if (busyId !== null) return
    setBusyId('bank')
    onError('')
    try {
      await updateGrantBankDetails({ data: { awardId: grant.id, ...draft } })
      await onChanged()
      setEditing(false)
      // A number that was hidden before the edit goes back to hidden after it.
      setRevealed(false)
    } catch (err) {
      onError(messageFor(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Section
      title="Bank details"
      aside={
        <Badge size="sm" className={badge.className}>
          {badge.label}
        </Badge>
      }
      action={
        grant.canEdit ? (
          <EditControls
            editing={editing}
            busy={saving}
            onEdit={() => {
              setDraft({
                accountName: bank.accountName ?? '',
                bankName: bank.bankName ?? '',
                sortCode: bank.sortCode ?? '',
                accountNumber: bank.accountNumber ?? '',
              })
              setEditing(true)
            }}
            onSave={save}
            onCancel={() => {
              setEditing(false)
              onError('')
            }}
          />
        ) : undefined
      }
    >
      {/* Above the fields in both modes, for the same reason the badge stays visible
          while editing: it is the thing being fixed. */}
      {tone && (
        <p
          className={cn(
            'flex items-center gap-2 rounded-chip px-3 py-2 text-label leading-normal',
            tone.panel,
          )}
        >
          <BankAlertIcon className="shrink-0" />
          <span>{BANK_DETAIL_TEXT[bank.status]}</span>
        </p>
      )}

      {editing ? (
        <>
          {field('accountName', 'Account name', 'Enter account name')}
          {field('bankName', 'Bank', 'Enter bank')}
          {field('sortCode', 'Sort code', '00-00-00')}
          {field('accountNumber', 'Account number', 'Enter account number')}
          <p className="text-label text-grey-400">
            These are the details the grantee submitted, and they are where the money goes. Changing
            the sort code or account number is recorded against the grant.
          </p>
        </>
      ) : (
        <>
          <Row label="Account name" value={bank.accountName ?? '—'} />
          <Row label="Bank" value={bank.bankName ?? '—'} />
          <Row
            label="Sort code"
            valueColour={flagged.sortCode ? tone?.figure : undefined}
            value={
              <span className="inline-flex items-center gap-2">
                <span className="tabular-nums">{fmtSortCode(bank.sortCode)}</span>
                {flagged.sortCode && <BankAlertIcon />}
              </span>
            }
          />
          <Row
            label="Account number"
            valueColour={flagged.accountNumber ? tone?.figure : undefined}
            value={
              <span className="inline-flex items-center gap-2">
                <span className="tabular-nums">
                  {bank.accountNumber
                    ? revealed
                      ? bank.accountNumber
                      : `••••${bank.last4 ?? ''}`
                    : '—'}
                </span>
                {flagged.accountNumber && <BankAlertIcon />}
              </span>
            }
            action={
              bank.accountNumber ? (
                <Button variant="text" size="xs" onClick={() => setRevealed((r) => !r)}>
                  {revealed ? 'Hide' : 'Show'}
                </Button>
              ) : undefined
            }
          />

          {!tone && <p className="text-label text-grey-400">{BANK_DETAIL_TEXT.valid}</p>}

          {bank.status !== 'valid' && (
            <p className="text-label text-grey-400">
              Details come from the{' '}
              <TextLink
                to="/applications/$applicationId"
                params={{ applicationId: grant.applicationId }}
              >
                application
              </TextLink>
              {grant.externalApplicationId ? ` (${grant.externalApplicationId})` : ''} — ask the
              grantee to resubmit them, or correct them here.
            </p>
          )}
        </>
      )}
    </Section>
  )
}
