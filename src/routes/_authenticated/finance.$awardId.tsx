import { useState } from 'react'
import { orNotFound } from '../../lib/loader'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { BankIcon, Calendar03Icon, Coins01Icon, Wallet01Icon } from '@hugeicons/core-free-icons'
import { getFinanceGrant, type BankStatus } from '../../server/fns/finance'
import { setInstalmentPaid, updateInstalment } from '../../server/fns/applications'
import { Badge, Breadcrumb, Button, Card, KPI_TINTS, MiniKpi, TextLink } from '../../components/ui'
import { fmtDate, fmtMoney } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/finance/$awardId')({
  loader: ({ params }) => orNotFound(getFinanceGrant({ data: { id: params.awardId } })),
  component: FinanceGrantDetail,
})

type Grant = Awaited<ReturnType<typeof getFinanceGrant>>

const PAY_STATUS = {
  paid: { label: 'Paid', className: 'bg-success/10 text-success' },
  overdue: { label: 'Overdue', className: 'bg-danger/10 text-danger' },
  due_soon: { label: 'Due soon', className: 'bg-warning/10 text-warning' },
  upcoming: { label: 'Upcoming', className: 'bg-gray-100 text-gray-500' },
  tbc: { label: 'Date TBC', className: 'bg-gray-100 text-gray-400' },
}

const GRANT_STATUS = {
  overdue: { label: 'Payment overdue', className: 'bg-danger/10 text-danger' },
  due_soon: { label: 'Payment due soon', className: 'bg-warning/10 text-warning' },
  scheduled: { label: 'Scheduled', className: 'bg-gray-100 text-gray-600' },
  unscheduled: { label: 'No payment schedule', className: 'bg-warning/10 text-warning' },
  paid: { label: 'Paid in full', className: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-500' },
}

const inputClass =
  'rounded-chip border border-gray-200 px-2.5 py-1.5 text-body focus:outline-hidden focus:ring-2 focus:ring-gray-400'

function FinanceGrantDetail() {
  const grant = Route.useLoaderData()

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: 'Finance', to: '/finance' }, { label: grant.organisationName }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-heading font-semibold text-gray-900">
            {grant.organisationName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-gray-500">
            {grant.programmeName && (
              <span>
                <span className="text-gray-400">Programme </span>
                <span className="font-medium text-gray-700">{grant.programmeName}</span>
              </span>
            )}
            {grant.roundName && (
              <span>
                <span className="text-gray-400">Round </span>
                <span className="font-medium text-gray-700">{grant.roundName}</span>
              </span>
            )}
            <span>
              <span className="text-gray-400">Awarded </span>
              <span className="font-medium text-gray-700">{fmtDate(grant.decisionAt)}</span>
            </span>
            {grant.durationYears && (
              <span>
                <span className="text-gray-400">Term </span>
                <span className="font-medium text-gray-700">
                  {grant.durationYears} yr{grant.durationYears > 1 ? 's' : ''}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={GRANT_STATUS[grant.status]?.className ?? 'bg-gray-100 text-gray-600'}>
            {GRANT_STATUS[grant.status]?.label ?? grant.status}
          </Badge>
          <TextLink to="/awards/$awardId" params={{ awardId: grant.id }} className="text-label">
            Award record →
          </TextLink>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniKpi
          tint={KPI_TINTS.violet}
          icon={Coins01Icon}
          label="Committed"
          value={fmtMoney(grant.committed)}
          sub={
            grant.durationYears
              ? `over ${grant.durationYears} year${grant.durationYears > 1 ? 's' : ''}`
              : 'single award'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.green}
          icon={BankIcon}
          label="Paid to date"
          value={fmtMoney(grant.paidToDate)}
          sub={`${grant.paidCount} of ${grant.instalmentCount} instalment${grant.instalmentCount === 1 ? '' : 's'}`}
        />
        <MiniKpi
          tint={KPI_TINTS.amber}
          icon={Wallet01Icon}
          label="Outstanding"
          value={fmtMoney(grant.outstanding)}
          sub={grant.lastPaidDate ? `last paid ${fmtDate(grant.lastPaidDate)}` : 'nothing paid yet'}
        />
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={Calendar03Icon}
          label="Next payment"
          value={grant.nextPayment ? fmtMoney(grant.nextPayment.amount) : '—'}
          valueColor={grant.status === 'overdue' ? 'var(--color-danger)' : undefined}
          sub={
            grant.nextPayment
              ? grant.nextPayment.dueDate
                ? `due ${fmtDate(grant.nextPayment.dueDate)}`
                : 'date TBC'
              : 'nothing scheduled'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <PaymentsCard grant={grant} />
        </div>
        <div className="space-y-4">
          <ReadinessCard grant={grant} />
          <BankCard grant={grant} />
          <BudgetCard grant={grant} />
        </div>
      </div>
    </div>
  )
}

// ─── Payment schedule ────────────────────────────────────────────────────────

function PaymentsCard({ grant }: { grant: Grant }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftAmount, setDraftAmount] = useState('')

  const pct =
    grant.scheduledTotal > 0 ? Math.round((grant.paidToDate / grant.scheduledTotal) * 100) : 0
  const upcoming = grant.instalments.filter((i) => !i.paidDate)
  const paid = grant.instalments.filter((i) => i.paidDate)

  async function togglePaid(id: string, paid: boolean) {
    setBusyId(id)
    try {
      await setInstalmentPaid({ data: { id, paid } })
      await router.invalidate()
    } finally {
      setBusyId(null)
    }
  }

  function beginEdit(inst: Grant['instalments'][number]) {
    setEditId(inst.id)
    setDraftDate(inst.dueDate ?? '')
    setDraftAmount(String(inst.amount))
  }

  async function saveEdit(id: string) {
    setBusyId(id)
    try {
      await updateInstalment({
        data: {
          id,
          amount: draftAmount ? Number(draftAmount) : undefined,
          dueDate: draftDate || null,
        },
      })
      setEditId(null)
      await router.invalidate()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-gray-900">Payment schedule</h2>
        <span className="text-label text-gray-400">
          {fmtMoney(grant.paidToDate)} of {fmtMoney(grant.scheduledTotal)} scheduled
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </div>

      {/* The plan and the promise are separate numbers, and they drift: an award can be
          committed at £60k with only £40k of instalments written down. */}
      {Math.round(grant.unallocated) !== 0 && (
        <p className="mt-3 rounded-control bg-warning/10 px-3 py-2 text-label text-warning">
          {grant.unallocated > 0
            ? `${fmtMoney(grant.unallocated)} of the committed amount is not on the schedule yet.`
            : `The schedule is ${fmtMoney(-grant.unallocated)} more than the committed amount.`}
        </p>
      )}

      {grant.instalments.length === 0 ? (
        <p className="mt-4 text-body text-gray-400">
          No instalments recorded. Add a schedule on the{' '}
          <TextLink to="/awards/$awardId" params={{ awardId: grant.id }}>
            award record
          </TextLink>
          .
        </p>
      ) : (
        <>
          {/* Split rather than one flat list: "what has gone out" and "what is still to
              go" are two different questions, and the second is the one being worked. */}
          <Group title="Still to come" rows={upcoming} count={upcoming.length} />
          <Group title="Paid" rows={paid} count={paid.length} />
        </>
      )}
    </Card>
  )

  function Group({
    title,
    rows,
    count,
  }: {
    title: string
    rows: Grant['instalments']
    count: number
  }) {
    if (count === 0) return null
    return (
      <div className="mt-4">
        <p className="text-label font-semibold uppercase tracking-wide text-gray-400">
          {title} <span className="tabular-nums text-gray-300">{count}</span>
        </p>
        <ul className="divide-y divide-gray-100">
          {rows.map((inst) => {
            const meta = PAY_STATUS[inst.status] ?? PAY_STATUS.upcoming
            return (
              <li key={inst.id} className="py-2.5">
                {editId === inst.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-label text-gray-400">#{inst.instalmentNo}</span>
                    <input
                      type="number"
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      className={`${inputClass} w-28`}
                      placeholder="Amount"
                    />
                    <input
                      type="date"
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                      className={inputClass}
                    />
                    <Button
                      size="sm"
                      onClick={() => saveEdit(inst.id)}
                      disabled={busyId === inst.id}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-label text-gray-400">#{inst.instalmentNo}</span>
                      <span className="font-medium tabular-nums text-gray-900">
                        {fmtMoney(inst.amount)}
                      </span>
                      <span className="text-label text-gray-500">
                        {inst.paidDate
                          ? `Paid ${fmtDate(inst.paidDate)}`
                          : `Due ${fmtDate(inst.dueDate)}`}
                      </span>
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </div>
                    {grant.canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          onClick={() => togglePaid(inst.id, !inst.paidDate)}
                          disabled={busyId === inst.id}
                          variant="secondary"
                          size="xs"
                        >
                          {inst.paidDate ? 'Undo' : 'Mark paid'}
                        </Button>
                        <Button onClick={() => beginEdit(inst)} variant="secondary" size="xs">
                          Edit
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
}

// ─── Payment readiness ───────────────────────────────────────────────────────

/**
 * The prototype's "payment lifecycle" — but every step derived from data we actually
 * hold, so it reads as a genuine pre-payment checklist rather than decoration.
 */
function ReadinessCard({ grant }: { grant: Grant }) {
  const bankOk = grant.bank.status === 'valid'
  const steps: Array<{ done: boolean; warn?: boolean; name: string; detail: string }> = [
    {
      done: true,
      name: 'Grant approved',
      detail: `${fmtMoney(grant.committed)} committed · ${fmtDate(grant.decisionAt)}`,
    },
    {
      done: grant.instalmentCount > 0,
      name: 'Payment schedule set',
      detail:
        grant.instalmentCount > 0
          ? `${grant.instalmentCount} instalment${grant.instalmentCount === 1 ? '' : 's'} · ${fmtMoney(grant.scheduledTotal)}`
          : 'No instalments recorded',
    },
    {
      done: bankOk,
      warn: grant.bank.status === 'invalid',
      name: 'Bank details verified',
      detail: BANK_DETAIL_TEXT[grant.bank.status],
    },
  ]

  return (
    <Card className="px-5 py-4">
      <h2 className="text-body font-semibold text-gray-900">Payment readiness</h2>
      <ul className="mt-3 space-y-2.5">
        {steps.map((s) => (
          <li key={s.name} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-label font-semibold ${
                s.done
                  ? 'bg-success/10 text-success'
                  : s.warn
                    ? 'bg-danger/10 text-danger'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {s.done ? '✓' : s.warn ? '!' : '·'}
            </span>
            <div className="min-w-0">
              <p className="text-body font-medium text-gray-900">{s.name}</p>
              <p className={`text-label ${s.warn ? 'text-danger' : 'text-gray-400'}`}>{s.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {grant.nextPayment && (
        <div
          className={`mt-3 rounded-control px-3 py-2.5 ${
            grant.status === 'overdue' ? 'bg-danger/10' : 'bg-gray-50'
          }`}
        >
          <p className={`text-label ${grant.status === 'overdue' ? 'text-danger' : 'text-gray-500'}`}>
            Next payment
          </p>
          <p
            className={`text-body font-semibold ${
              grant.status === 'overdue' ? 'text-danger' : 'text-gray-900'
            }`}
          >
            {fmtMoney(grant.nextPayment.amount)}
            <span className="ml-1.5 text-label font-normal">
              {grant.nextPayment.dueDate ? `due ${fmtDate(grant.nextPayment.dueDate)}` : 'date TBC'}
            </span>
          </p>
        </div>
      )}
    </Card>
  )
}

// ─── Bank details ────────────────────────────────────────────────────────────

const BANK_DETAIL_TEXT: Record<BankStatus, string> = {
  valid: 'Sort code and account number pass the modulus check',
  invalid: 'Fails the modulus check — likely a typo',
  unchecked: 'Not in a checkable format',
  missing: 'No bank details on file',
}

const BANK_BADGE: Record<BankStatus, { label: string; className: string }> = {
  valid: { label: 'Modulus check passed', className: 'bg-success/10 text-success' },
  invalid: { label: 'Modulus check failed', className: 'bg-danger/10 text-danger' },
  unchecked: { label: 'Not checkable', className: 'bg-warning/10 text-warning' },
  missing: { label: 'Not provided', className: 'bg-gray-100 text-gray-500' },
}

/** "402918" → "40-29-18"; anything unexpected is shown as given. */
function fmtSortCode(value: string | null) {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  return digits.length === 6
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
    : value
}

function BankCard({ grant }: { grant: Grant }) {
  const [revealed, setRevealed] = useState(false)
  const { bank } = grant
  const badge = BANK_BADGE[bank.status]

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-gray-900">Bank details</h2>
        <Badge className={badge.className}>{badge.label}</Badge>
      </div>

      <dl className="mt-3 space-y-2.5">
        <Row label="Account name" value={bank.accountName ?? '—'} />
        <Row label="Bank" value={bank.bankName ?? '—'} />
        <Row label="Sort code" value={fmtSortCode(bank.sortCode)} mono />
        <Row
          label="Account number"
          value={
            bank.accountNumber ? (revealed ? bank.accountNumber : `••••${bank.last4 ?? ''}`) : '—'
          }
          mono
          action={
            bank.accountNumber ? (
              <Button variant="text" size="xs" onClick={() => setRevealed((r) => !r)}>
                {revealed ? 'Hide' : 'Show'}
              </Button>
            ) : undefined
          }
        />
      </dl>

      <p className="mt-3 text-label text-gray-400">
        {BANK_DETAIL_TEXT[bank.status]}. The check confirms the numbers are a valid pair, not who
        owns the account.
      </p>

      {bank.status !== 'valid' && (
        <p className="mt-2 text-label text-gray-400">
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
    </Card>
  )
}

function Row({
  label,
  value,
  mono,
  action,
}: {
  label: string
  value: string
  mono?: boolean
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-label text-gray-400">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className={`text-body text-gray-900 ${mono ? 'font-mono tabular-nums' : ''}`}>
          {value}
        </span>
        {action}
      </dd>
    </div>
  )
}

// ─── Programme budget ────────────────────────────────────────────────────────

function BudgetCard({ grant }: { grant: Grant }) {
  const b = grant.budget
  if (!b || b.budget <= 0) return null
  const committedPct = Math.min(100, Math.round((b.committed / b.budget) * 100))
  const paidPct = Math.min(100, Math.round((b.paidToDate / b.budget) * 100))
  const share = b.committed > 0 ? Math.round((grant.committed / b.committed) * 100) : 0

  return (
    <Card className="px-5 py-4">
      <h2 className="text-body font-semibold text-gray-900">
        Programme budget{grant.programmeName ? ` · ${grant.programmeName}` : ''}
      </h2>
      <div className="mt-3 flex justify-between text-label">
        <span className="text-gray-500">Committed</span>
        <span className="font-medium tabular-nums text-gray-700">
          {fmtMoney(b.committed)} / {fmtMoney(b.budget)}
        </span>
      </div>
      {/* Paid sits inside committed: the darker bar is money out, the lighter is promised. */}
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-success/10"
          style={{ width: `${committedPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-success"
          style={{ width: `${paidPct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-label text-gray-400">
        <span>{fmtMoney(b.paidToDate)} paid</span>
        <span>{fmtMoney(Math.max(0, b.budget - b.committed))} uncommitted</span>
      </div>
      <p className="mt-2.5 text-label text-gray-400">
        This grant is {share}% of the {b.grantCount} award{b.grantCount === 1 ? '' : 's'} committed
        from this round programme.
      </p>
    </Card>
  )
}
