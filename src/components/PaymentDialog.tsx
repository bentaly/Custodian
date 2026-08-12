import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  MoneyAdd02Icon,
  MoneyRemove02Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { setInstalmentPaid, updateInstalment } from '../server/fns/applications'
import type { getFinanceGrant, BankStatus } from '../server/fns/finance'
import { ActionMenu, Badge, Button, DateField, Dialog, TextLink, cn } from './ui'
import { C } from './ui/tokens'
import { fmtDate, fmtMoney } from '../lib/format'
import { messageFor } from '../lib/errors'

// The payment panel (Figma 672:25886) — one grant's money in a dialog over the Finance
// list, replacing the old `/finance/$awardId` detail screen. Three sections, in the
// order a payment run needs them: is this grant ready to pay, what is the schedule, and
// where would the money go.
//
// Two deliberate departures from the comp:
//
//   * Bank details never say "Correct". All we run is a level-1 modulus check, which
//     proves the sort code and account number are a valid pair and NOTHING about who
//     owns the account. "Correct" would be read as "we checked this is the grantee",
//     which is Confirmation of Payee — a paid check we do not make.
//   * There is no "Payment #2 due" lifecycle row. The schedule below it already says
//     what is due and when, in more detail and without a second copy to drift.

export type FinanceGrant = Awaited<ReturnType<typeof getFinanceGrant>>
type Instalment = FinanceGrant['instalments'][number]

const inputClass =
  'rounded-chip border border-gray-200 px-2.5 py-1.5 text-body focus:outline-hidden focus:ring-2 focus:ring-gray-400'

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
        <BankDetails grant={grant} />
      </div>
    </Dialog>
  )
}

// ─── Section shell ───────────────────────────────────────────────────────────

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-control border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-title font-medium text-gray-900">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** The label/value row every section is built from. */
function Row({
  label,
  value,
  valueColor,
  icon,
  action,
  trailing,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  valueColor?: string
  icon?: React.ReactNode
  /** Sits BEFORE the value — a reveal toggle, an inline note. */
  action?: React.ReactNode
  /**
   * Sits AFTER the value, in a fixed 32px slot. Every row in a section must either
   * supply it or reserve it (`<RowSlot />`): the figures in a column are read against
   * each other and against the total, so one row growing a kebab must not shunt its
   * number out of line with the rest.
   */
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="font-display text-body font-medium text-gray-500">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <span
          className="whitespace-nowrap text-right font-display text-body font-medium"
          style={{ color: valueColor ?? C.ink }}
        >
          {value}
        </span>
        {trailing}
      </div>
    </div>
  )
}

/** The empty half of the `trailing` slot — an aligned column costs one placeholder. */
function RowSlot() {
  return <span aria-hidden className="size-8 shrink-0" />
}

// ─── Grant lifecycle ─────────────────────────────────────────────────────────

/**
 * Where this grant has got to, every step read off data we actually hold. The comp's
 * "Compliance guidance issued" has no column behind it, so the step that stands in its
 * place is the one that decides whether a payment can go out at all: is there a schedule.
 */
type StepState = 'done' | 'warn' | 'pending'

const BANK_STEP: Record<BankStatus, { state: StepState; text: string }> = {
  valid: { state: 'done', text: 'Modulus check passed' },
  invalid: { state: 'warn', text: 'Modulus check failed' },
  unchecked: { state: 'warn', text: 'Not checkable' },
  missing: { state: 'warn', text: 'Not provided' },
}

function Lifecycle({ grant }: { grant: FinanceGrant }) {
  const letter = grant.letter
  const letterStep: { state: StepState; text: string } =
    letter?.status === 'sent'
      ? { state: 'done', text: fmtDate(letter.sentAt) }
      : letter?.status === 'failed'
        ? { state: 'warn', text: 'Send failed' }
        : { state: 'pending', text: 'Not sent' }

  const bankStep = BANK_STEP[grant.bank.status]

  const steps: Array<{ name: string; state: StepState; text: string }> = [
    { name: 'Award approved', state: 'done', text: fmtDate(grant.decisionAt) },
    { name: 'Award letter sent', ...letterStep },
    {
      name: 'Payment schedule set',
      state: grant.instalmentCount > 0 ? 'done' : 'warn',
      text:
        grant.instalmentCount > 0
          ? `${grant.instalmentCount} instalment${grant.instalmentCount === 1 ? '' : 's'}`
          : 'None',
    },
    { name: 'Bank details', ...bankStep },
  ]

  return (
    <Section title="Grant lifecycle">
      {steps.map((s) => (
        <Row
          key={s.name}
          label={s.name}
          value={s.text}
          valueColor={s.state === 'warn' ? C.warning : s.state === 'pending' ? C.faint : C.ink}
          icon={<StepIcon state={s.state} />}
        />
      ))}
    </Section>
  )
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return <HugeiconsIcon icon={Tick02Icon} size={16} color={C.success} strokeWidth={2} />
  }
  if (state === 'warn') {
    return <HugeiconsIcon icon={Alert02Icon} size={16} color={C.warning} strokeWidth={2} />
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
  upcoming: { label: 'Upcoming', className: 'bg-gray-100 text-gray-400' },
  tbc: { label: 'Date TBC', className: 'bg-gray-100 text-gray-400' },
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
  const [editId, setEditId] = useState<string | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftAmount, setDraftAmount] = useState('')

  // "Due next" is a position in the queue, not a status: the earliest unpaid instalment
  // that has not already gone past its date.
  const nextId = grant.instalments.find((i) => !i.paidDate && i.status !== 'overdue')?.id ?? null

  async function run(id: string, work: () => Promise<unknown>) {
    // Guarded rather than disabling the menu items: `ActionMenu` renders nothing when
    // every action is disabled, so the kebab would vanish and reappear mid-write.
    if (busyId !== null) return
    setBusyId(id)
    onError('')
    try {
      await work()
      await onChanged()
      setEditId(null)
    } catch (err) {
      onError(messageFor(err))
    } finally {
      setBusyId(null)
    }
  }

  function beginEdit(inst: Instalment) {
    setEditId(inst.id)
    setDraftDate(inst.dueDate ?? '')
    setDraftAmount(String(inst.amount))
  }

  return (
    <Section
      title="Payment schedule"
      aside={
        grant.instalmentCount > 0 ? (
          <span className="font-display text-label text-gray-400">
            {grant.paidCount} of {grant.instalmentCount} paid
          </span>
        ) : undefined
      }
    >
      {/* The plan and the promise are separate numbers, and they drift: an award can be
          committed at £60k with only £40k of instalments written down. */}
      {Math.round(grant.unallocated) !== 0 && (
        <p className="rounded-control bg-warning/10 px-3 py-2 text-label text-warning">
          {grant.unallocated > 0
            ? `${fmtMoney(grant.unallocated)} of the committed amount is not on the schedule yet.`
            : `The schedule is ${fmtMoney(-grant.unallocated)} more than the committed amount.`}
        </p>
      )}

      {grant.instalments.length === 0 ? (
        <p className="text-body text-gray-400">
          No instalments recorded. Add a schedule on the{' '}
          <TextLink to="/awards/$awardId" params={{ awardId: grant.id }}>
            award record
          </TextLink>
          .
        </p>
      ) : (
        <>
          {grant.instalments.map((inst) => {
            const key = inst.paidDate
              ? 'paid'
              : inst.id === nextId && inst.dueDate
                ? 'next'
                : inst.status
            const badge = PAY_BADGE[key] ?? PAY_BADGE.upcoming!
            const busy = busyId === inst.id

            if (editId === inst.id) {
              return (
                <div key={inst.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-label text-gray-400">#{inst.instalmentNo}</span>
                  <input
                    type="number"
                    value={draftAmount}
                    onChange={(e) => setDraftAmount(e.target.value)}
                    className={`${inputClass} w-28`}
                    placeholder="Amount"
                    aria-label="Instalment amount"
                  />
                  <DateField
                    size="sm"
                    value={draftDate}
                    onChange={setDraftDate}
                    className="w-40"
                    aria-label="Instalment due date"
                  />
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      run(inst.id, () =>
                        updateInstalment({
                          data: {
                            id: inst.id,
                            amount: draftAmount ? Number(draftAmount) : undefined,
                            dueDate: draftDate || null,
                          },
                        }),
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditId(null)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              )
            }

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
                className={busy ? 'opacity-60' : undefined}
                value={<span className="font-semibold text-brand">{fmtMoney(inst.amount)}</span>}
                trailing={
                  grant.canEdit ? (
                    // Everything you can do to an instalment lives in one menu, after the
                    // figure. Marking paid is the routine act and the corrections are
                    // rare, so the paid/unpaid item leads and the destructive one is last.
                    <ActionMenu
                      label={`Actions for instalment ${inst.instalmentNo}`}
                      actions={
                        inst.paidDate
                          ? [
                              {
                                label: 'Edit amount & date',
                                icon: PencilEdit02Icon,
                                onSelect: () => beginEdit(inst),
                              },
                              // Named by its effect, not "Undo": this row may have been
                              // paid eight months ago, and un-marking it says the money
                              // never went out — not that a recent click was a mistake.
                              {
                                label: 'Mark as unpaid',
                                icon: MoneyRemove02Icon,
                                destructive: true,
                                onSelect: () =>
                                  run(inst.id, () =>
                                    setInstalmentPaid({ data: { id: inst.id, paid: false } }),
                                  ),
                              },
                            ]
                          : [
                              {
                                label: 'Mark as paid',
                                icon: MoneyAdd02Icon,
                                onSelect: () =>
                                  run(inst.id, () =>
                                    setInstalmentPaid({ data: { id: inst.id, paid: true } }),
                                  ),
                              },
                              {
                                label: 'Edit amount & date',
                                icon: PencilEdit02Icon,
                                onSelect: () => beginEdit(inst),
                              },
                            ]
                      }
                    />
                  ) : undefined
                }
              />
            )
          })}

          <div className="border-t border-gray-200 pt-3">
            <Row
              label="Total"
              value={
                <span className="font-semibold text-brand">{fmtMoney(grant.scheduledTotal)}</span>
              }
              // No menu on the total, but it still reserves the slot — otherwise the one
              // figure the instalments are meant to add up to is the one out of line.
              trailing={grant.canEdit ? <RowSlot /> : undefined}
            />
          </div>
        </>
      )}
    </Section>
  )
}

// ─── Bank details ────────────────────────────────────────────────────────────

const BANK_BADGE: Record<BankStatus, { label: string; className: string }> = {
  valid: { label: 'Modulus check passed', className: 'bg-success/10 text-success' },
  invalid: { label: 'Modulus check failed', className: 'bg-danger/10 text-danger' },
  unchecked: { label: 'Not checkable', className: 'bg-warning/10 text-warning' },
  missing: { label: 'Not provided', className: 'bg-gray-100 text-gray-500' },
}

const BANK_DETAIL_TEXT: Record<BankStatus, string> = {
  valid: 'Sort code and account number pass the modulus check',
  invalid: 'Fails the modulus check — likely a typo',
  unchecked: 'Not in a checkable format',
  missing: 'No bank details on file',
}

/** `402918` → `40-29-18`; anything unexpected is shown as given. */
function fmtSortCode(value: string | null) {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  return digits.length === 6
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
    : value
}

function BankDetails({ grant }: { grant: FinanceGrant }) {
  const [revealed, setRevealed] = useState(false)
  const { bank } = grant
  const badge = BANK_BADGE[bank.status]

  return (
    <Section
      title="Bank details"
      aside={
        <Badge size="sm" className={badge.className}>
          {badge.label}
        </Badge>
      }
    >
      <Row label="Account name" value={bank.accountName ?? '—'} />
      <Row label="Bank" value={bank.bankName ?? '—'} />
      <Row
        label="Sort code"
        value={<span className="tabular-nums">{fmtSortCode(bank.sortCode)}</span>}
      />
      <Row
        label="Account number"
        value={
          <span className="tabular-nums">
            {bank.accountNumber ? (revealed ? bank.accountNumber : `••••${bank.last4 ?? ''}`) : '—'}
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

      <p className="text-label text-gray-400">
        {BANK_DETAIL_TEXT[bank.status]}. The check confirms the numbers are a valid pair, not who
        owns the account.
      </p>

      {bank.status !== 'valid' && (
        <p className="text-label text-gray-400">
          Details come from the{' '}
          <TextLink
            to="/applications/$applicationId"
            params={{ applicationId: grant.applicationId }}
          >
            application
          </TextLink>
          {grant.externalApplicationId ? ` (${grant.externalApplicationId})` : ''} — ask the grantee
          to resubmit them.
        </p>
      )}
    </Section>
  )
}
