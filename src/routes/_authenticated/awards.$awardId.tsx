import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { useState } from 'react'
import {
  getAward,
  addReportMilestone,
  updateReportMilestone,
  deleteReportMilestone,
  setInstalmentPaid,
  updateInstalment,
} from '../../server/fns/applications'
import { resendAwardLetter } from '../../server/fns/awardSetup'
import { AwardLetterPreview } from '../../components/AwardLetterPreview'
import { BankIcon, Calendar03Icon, Coins01Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  DateField,
  EmptyState,
  KPI_TINTS,
  MiniKpi,
  TextLink,
} from '../../components/ui'
import { fmtDate, fmtMoney } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/awards/$awardId')({
  loader: ({ params }) => orNotFound(getAward({ data: { id: params.awardId } })),
  component: AwardDetail,
})

type AwardData = Awaited<ReturnType<typeof getAward>>

const AWARD_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success/10 text-success' },
  completed: { label: 'Done', className: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'Cancelled', className: 'bg-danger/10 text-danger' },
}

const SCHED_STATUS = {
  paid: { label: 'Paid', className: 'bg-success/10 text-success' },
  submitted: { label: 'Received', className: 'bg-info/10 text-info' },
  overdue: { label: 'Overdue', className: 'bg-danger/10 text-danger' },
  due_soon: { label: 'Due soon', className: 'bg-warning/10 text-warning' },
  upcoming: { label: 'Upcoming', className: 'bg-gray-100 text-gray-500' },
  tbc: { label: 'Date TBC', className: 'bg-gray-100 text-gray-400' },
}

const inputClass =
  'rounded-chip border border-gray-200 px-2.5 py-1.5 text-body focus:outline-hidden focus:ring-2 focus:ring-gray-400'

function AwardDetail() {
  const award = Route.useLoaderData()
  const { impact } = award

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: 'Awards', to: '/awards', search: { roundId: undefined } },
          { label: award.organisationName },
        ]}
      />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-heading font-semibold text-gray-900">
            {award.organisationName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-gray-500">
            {award.programmeName && (
              <span>
                <span className="text-gray-400">Programme </span>
                <span className="font-medium text-gray-700">{award.programmeName}</span>
              </span>
            )}
            {award.roundName && (
              <span>
                <span className="text-gray-400">Round </span>
                <span className="font-medium text-gray-700">{award.roundName}</span>
              </span>
            )}
            {award.deliveryArea && (
              <span>
                <span className="text-gray-400">Geography </span>
                <span className="font-medium text-gray-700">{award.deliveryArea}</span>
              </span>
            )}
          </div>
        </div>
        <Badge className={AWARD_STATUS[award.status]?.className ?? 'bg-gray-100 text-gray-600'}>
          {AWARD_STATUS[award.status]?.label ?? award.status}
        </Badge>
      </div>

      {/* Key figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniKpi
          tint={KPI_TINTS.violet}
          icon={Coins01Icon}
          label="Amount awarded"
          value={fmtMoney(award.amountAwarded)}
          sub={award.programmeName ?? 'unattributed'}
        />
        <MiniKpi
          tint={KPI_TINTS.green}
          icon={BankIcon}
          label="Paid to date"
          value={fmtMoney(award.paidToDate)}
          sub={`${fmtMoney(award.outstanding)} outstanding`}
        />
        <MiniKpi
          tint={KPI_TINTS.amber}
          icon={Calendar03Icon}
          label="Awarded"
          value={fmtDate(award.decisionAt)}
          sub={
            award.durationYears
              ? `over ${award.durationYears} yr${award.durationYears > 1 ? 's' : ''}`
              : 'single payment term'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={UserGroupIcon}
          label={impact.unitLabel ?? 'Impact'}
          value={impact.total != null ? impact.total.toLocaleString('en-GB') : '—'}
          sub={
            impact.total != null
              ? `across ${impact.reportCount} report${impact.reportCount !== 1 ? 's' : ''}`
              : 'no impact reported yet'
          }
        />
      </div>

      {/* What the money is for, in the foundation's own words — the thing a later
          grant report is read against, so it belongs above the mechanics. */}
      {award.purpose && (
        <Card className="px-5 py-4">
          <h2 className="text-body font-semibold text-gray-900">Grant purpose</h2>
          <p className="mt-1.5 text-body leading-relaxed text-gray-600">{award.purpose}</p>
          {/* One per line, as `renderAwardLetter` numbers them on the letter — a grant
              set up with three bespoke terms must not read here as one paragraph. */}
          {(() => {
            const bespoke = (award.specialCondition ?? '')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
            if (bespoke.length === 0) return null
            return (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <span className="text-label uppercase tracking-wide text-gray-400">
                  {bespoke.length === 1
                    ? 'Condition specific to this grant'
                    : 'Conditions specific to this grant'}
                </span>
                <ul className="mt-1 space-y-1">
                  {bespoke.map((line, i) => (
                    <li key={i} className="text-body leading-relaxed text-gray-600">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
        </Card>
      )}

      <ApplicationCard award={award} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentsCard award={award} />
        <ReportingCard award={award} />
      </div>

      <AwardLetterCard award={award} />

      <ReportsCard award={award} />
    </div>
  )
}

// ─── Award letter ────────────────────────────────────────────────────────────

const LETTER_STATUS: Record<string, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-success/10 text-success' },
  draft: { label: 'Not sent', className: 'bg-warning/10 text-warning' },
  failed: { label: 'Failed to send', className: 'bg-danger/10 text-danger' },
}

/**
 * The letter this grantee was actually sent. Shown verbatim from storage rather than
 * re-rendered, so it still reads as what was agreed even after the template, the
 * schedule or the conditions have moved on.
 */
function AwardLetterCard({ award }: { award: AwardData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const letter = award.letter

  async function handleResend() {
    setBusy(true)
    setError(null)
    try {
      await resendAwardLetter({ data: { awardId: award.id } })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The letter could not be sent')
    } finally {
      setBusy(false)
    }
  }

  if (!letter) {
    return (
      <Card className="px-5 py-4">
        <h2 className="text-body font-semibold text-gray-900">Award letter</h2>
        <p className="mt-1.5 text-label leading-relaxed text-gray-400">
          No letter was issued for this grant. Letters are written and sent during award set-up —
          awards made before that existed have none.
        </p>
      </Card>
    )
  }

  const status = LETTER_STATUS[letter.status] ?? LETTER_STATUS.draft!

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-gray-900">Award letter</h2>
        <div className="flex items-center gap-2">
          <Badge className={status.className}>{status.label}</Badge>
          <Button variant="text" size="sm" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Read the letter'}
          </Button>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-label text-gray-400">
        <span>
          To <span className="text-gray-600">{letter.recipientEmail ?? 'nobody — no address'}</span>
        </span>
        {letter.replyTo && (
          <span>
            Replies to <span className="text-gray-600">{letter.replyTo}</span>
          </span>
        )}
        {letter.sentAt && (
          <span>
            Sent <span className="text-gray-600">{fmtDate(letter.sentAt)}</span>
          </span>
        )}
      </div>

      {letter.status !== 'sent' && letter.failureReason && (
        <p className="mt-2 rounded-chip bg-warning/10 px-3 py-2 text-label text-warning">
          {letter.failureReason}
        </p>
      )}

      {open && (
        <div className="mt-3 rounded-card border border-gray-100 bg-background px-5 py-4">
          <div className="mb-3 border-b border-gray-100 pb-2 text-label text-gray-400">
            Subject: <span className="text-gray-600">{letter.subject}</span>
          </div>
          <AwardLetterPreview bodyText={letter.bodyText} />
        </div>
      )}

      {award.canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleResend} disabled={busy}>
            {busy ? 'Sending…' : letter.status === 'sent' ? 'Send again' : 'Send now'}
          </Button>
          {error && <span className="text-label text-danger">{error}</span>}
        </div>
      )}
    </Card>
  )
}

// ─── Payments ────────────────────────────────────────────────────────────────

function PaymentsCard({ award }: { award: AwardData }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftAmount, setDraftAmount] = useState('')

  const pct =
    award.scheduledTotal > 0 ? Math.round((award.paidToDate / award.scheduledTotal) * 100) : 0

  async function togglePaid(id: string, paid: boolean) {
    setBusyId(id)
    try {
      await setInstalmentPaid({ data: { id, paid } })
      await router.invalidate()
    } finally {
      setBusyId(null)
    }
  }

  function beginEdit(inst: AwardData['instalments'][number]) {
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
        <h2 className="text-body font-semibold text-gray-900">Payments</h2>
        <span className="text-label text-gray-400">
          {award.paidCount}/{award.instalmentCount} instalments
        </span>
      </div>

      {/* Progress */}
      <div className="mt-3 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-label tabular-nums text-gray-500">
          {fmtMoney(award.paidToDate)} / {fmtMoney(award.scheduledTotal)}
        </span>
      </div>

      {award.instalments.length === 0 ? (
        <p className="mt-4 text-body text-gray-400">No instalment schedule recorded.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {award.instalments.map((inst) => {
            const meta = SCHED_STATUS[inst.status] ?? SCHED_STATUS.upcoming
            const editing = editId === inst.id
            return (
              <li key={inst.id} className="py-2.5">
                {editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-label text-gray-400">#{inst.instalmentNo}</span>
                    <input
                      type="number"
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      className={`${inputClass} w-28`}
                      placeholder="Amount"
                    />
                    <DateField
                      size="sm"
                      value={draftDate}
                      onChange={setDraftDate}
                      className="w-40"
                      aria-label={`Instalment ${inst.instalmentNo} due date`}
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-label text-gray-400">#{inst.instalmentNo}</span>
                      <span className="font-medium text-gray-900">{fmtMoney(inst.amount)}</span>
                      <span className="text-label text-gray-500">
                        {inst.paidDate
                          ? `Paid ${fmtDate(inst.paidDate)}`
                          : `Due ${fmtDate(inst.dueDate)}`}
                      </span>
                      <Badge size="sm" className={meta.className}>
                        {meta.label}
                      </Badge>
                    </div>
                    {award.canEditPayments && (
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
      )}
    </Card>
  )
}

// ─── Reporting schedule ──────────────────────────────────────────────────────

function ReportingCard({ award }: { award: AwardData }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftDate, setDraftDate] = useState('')
  const [adding, setAdding] = useState(false)

  function beginEdit(m: AwardData['reportingMilestones'][number]) {
    setAdding(false)
    setEditId(m.id)
    setDraftLabel(m.label)
    setDraftDate(m.dueDate)
  }

  function beginAdd() {
    setEditId(null)
    setAdding(true)
    setDraftLabel('')
    setDraftDate('')
  }

  async function save() {
    if (!draftLabel.trim() || !draftDate) return
    setBusyId(editId ?? 'new')
    try {
      if (adding) {
        await addReportMilestone({
          data: { awardId: award.id, label: draftLabel.trim(), dueDate: draftDate },
        })
      } else if (editId) {
        await updateReportMilestone({
          data: { id: editId, label: draftLabel.trim(), dueDate: draftDate },
        })
      }
      setEditId(null)
      setAdding(false)
      await router.invalidate()
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      await deleteReportMilestone({ data: { id } })
      await router.invalidate()
    } finally {
      setBusyId(null)
    }
  }

  const editor = (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <input
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        className={`${inputClass} flex-1`}
        placeholder="Report label (e.g. Interim report)"
      />
      <DateField
        size="sm"
        value={draftDate}
        onChange={setDraftDate}
        className="w-40"
        aria-label="Report due date"
      />
      <Button
        size="sm"
        onClick={save}
        disabled={busyId != null || !draftLabel.trim() || !draftDate}
      >
        Save
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setEditId(null)
          setAdding(false)
        }}
      >
        Cancel
      </Button>
    </div>
  )

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-gray-900">Reporting schedule</h2>
        {award.canEdit && !adding && (
          <Button variant="text" size="xs" onClick={beginAdd}>
            + Add date
          </Button>
        )}
      </div>

      {award.reportingMilestones.length === 0 && !adding ? (
        <p className="mt-4 text-body text-gray-400">No reporting dates set.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {award.reportingMilestones.map((m) => {
            const meta = SCHED_STATUS[m.status] ?? SCHED_STATUS.upcoming
            return (
              <li key={m.id}>
                {editId === m.id ? (
                  editor
                ) : (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="truncate font-medium text-gray-900">{m.label}</span>
                      <span className="shrink-0 text-label text-gray-500">
                        {m.submittedDate
                          ? `Received ${fmtDate(m.submittedDate)}`
                          : `Due ${fmtDate(m.dueDate)}`}
                      </span>
                      <Badge size="sm" className={meta.className}>
                        {meta.label}
                      </Badge>
                    </div>
                    {award.canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button onClick={() => beginEdit(m)} variant="secondary" size="xs">
                          Edit
                        </Button>
                        {!m.submittedDate && (
                          <Button
                            onClick={() => remove(m.id)}
                            disabled={busyId === m.id}
                            variant="dangerGhost"
                            size="xs"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
          {adding && <li>{editor}</li>}
        </ul>
      )}
    </Card>
  )
}

// ─── Reports received ────────────────────────────────────────────────────────

function ReportsCard({ award }: { award: AwardData }) {
  if (award.reports.length === 0) {
    return (
      <Card className="px-5 py-4">
        <h2 className="text-body font-semibold text-gray-900">Reports received</h2>
        <EmptyState className="mt-3 py-8">
          <p className="text-body text-gray-500">No reports received yet.</p>
          <p className="mt-1 text-label text-gray-400">
            Submitted reports are matched to this award automatically and will appear here.
          </p>
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card className="px-5 py-4">
      <h2 className="text-body font-semibold text-gray-900">Reports received</h2>
      <ul className="mt-3 divide-y divide-gray-100">
        {award.reports.map((r) => (
          <li key={r.id} className="py-3">
            <Link
              to="/reports/$reportKey"
              params={{ reportKey: r.id }}
              className="group flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 group-hover:underline">{r.label}</span>
                  <Badge
                    className={
                      r.status === 'reviewed'
                        ? 'bg-success/10 text-success'
                        : 'bg-info/10 text-info'
                    }
                  >
                    {r.status === 'reviewed' ? 'Reviewed' : 'Received'}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-body text-gray-600">
                  {r.aiSummary ?? r.impactSummary}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {r.impactQuantity != null && (
                  <p className="text-body font-semibold text-gray-900">
                    {Number(r.impactQuantity).toLocaleString('en-GB')}
                    {r.impactUnitLabel && (
                      <span className="ml-1 text-label font-normal text-gray-400">
                        {r.impactUnitLabel}
                      </span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 text-label text-gray-400">{fmtDate(r.submittedAt)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ─── Source application ──────────────────────────────────────────────────────

function ApplicationCard({ award }: { award: AwardData }) {
  const a = award.application
  const uplift = award.amountAwarded - a.amountRequested

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-gray-900">Source application</h2>
        <TextLink
          to="/applications/$applicationId"
          params={{ applicationId: a.id }}
          className="text-label"
        >
          View application →
        </TextLink>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-body sm:grid-cols-4">
        <Field label="Requested" value={fmtMoney(a.amountRequested)} />
        <Field
          label="Awarded"
          value={fmtMoney(award.amountAwarded)}
          sub={
            uplift === 0
              ? 'as requested'
              : uplift > 0
                ? `${fmtMoney(uplift)} above`
                : `${fmtMoney(-uplift)} below`
          }
        />
        <Field
          label="Custodian score"
          value={
            a.custodianScoreStatus === 'scored' && a.custodianScore != null
              ? `${a.custodianScore}/100`
              : '—'
          }
        />
        <Field label="Registration" value={a.charityNumber ?? a.companyNumber ?? '—'} />
        {a.externalApplicationId && (
          <Field label="Their reference" value={a.externalApplicationId} />
        )}
      </div>
    </Card>
  )
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-label uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 font-medium text-gray-900">{value}</p>
      {sub && <p className="text-label text-gray-400">{sub}</p>}
    </div>
  )
}
