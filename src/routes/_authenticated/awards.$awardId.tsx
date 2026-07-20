import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getAward,
  addReportMilestone,
  updateReportMilestone,
  deleteReportMilestone,
  setInstalmentPaid,
  updateInstalment,
} from '../../server/fns/applications'
import { Badge, Button, Card, EmptyState } from '../../components/ui'

export const Route = createFileRoute('/_authenticated/awards/$awardId')({
  loader: ({ params }) => getAward({ data: { id: params.awardId } }),
  component: AwardDetail,
})

type AwardData = Awaited<ReturnType<typeof getAward>>

function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}
function fmtDate(date: string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const AWARD_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700' },
  completed: { label: 'Done', className: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'Cancelled', className: 'bg-red-50 text-red-600' },
}

const SCHED_STATUS = {
  paid: { label: 'Paid', className: 'bg-emerald-50 text-emerald-700' },
  submitted: { label: 'Received', className: 'bg-blue-50 text-blue-700' },
  overdue: { label: 'Overdue', className: 'bg-red-50 text-red-600' },
  due_soon: { label: 'Due soon', className: 'bg-amber-50 text-amber-700' },
  upcoming: { label: 'Upcoming', className: 'bg-gray-100 text-gray-500' },
  tbc: { label: 'Date TBC', className: 'bg-gray-100 text-gray-400' },
}

const inputClass =
  'rounded border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400'

function AwardDetail() {
  const award = Route.useLoaderData()
  const { impact } = award

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link to="/awards" search={{ roundId: undefined }} className="hover:text-gray-600">
          Awards
        </Link>
        <span>›</span>
        <span className="text-gray-600">{award.organisationName}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[21px] font-semibold text-gray-900">
            {award.organisationName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Amount awarded" value={fmt(award.amountAwarded)} />
        <Stat label="Paid to date" value={fmt(award.paidToDate)} sub={`${fmt(award.outstanding)} outstanding`} />
        <Stat
          label="Awarded"
          value={fmtDate(award.decisionAt)}
          sub={award.durationYears ? `${award.durationYears} yr${award.durationYears > 1 ? 's' : ''}` : undefined}
        />
        <Stat
          label={impact.unitLabel ?? 'Impact'}
          value={impact.total != null ? impact.total.toLocaleString('en-GB') : '—'}
          sub={
            impact.total != null
              ? `across ${impact.reportCount} report${impact.reportCount !== 1 ? 's' : ''}`
              : 'no impact reported yet'
          }
        />
      </div>

      <ApplicationCard award={award} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentsCard award={award} />
        <ReportingCard award={award} />
      </div>

      <ReportsCard award={award} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
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

  const pct = award.scheduledTotal > 0 ? Math.round((award.paidToDate / award.scheduledTotal) * 100) : 0

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
        <h2 className="text-sm font-semibold text-gray-900">Payments</h2>
        <span className="text-xs text-gray-400">
          {award.paidCount}/{award.instalmentCount} instalments
        </span>
      </div>

      {/* Progress */}
      <div className="mt-3 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-gray-500">
          {fmt(award.paidToDate)} / {fmt(award.scheduledTotal)}
        </span>
      </div>

      {award.instalments.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">No instalment schedule recorded.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {award.instalments.map((inst) => {
            const meta = SCHED_STATUS[inst.status] ?? SCHED_STATUS.upcoming
            const editing = editId === inst.id
            return (
              <li key={inst.id} className="py-2.5">
                {editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-400">#{inst.instalmentNo}</span>
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
                    <Button size="sm" onClick={() => saveEdit(inst.id)} disabled={busyId === inst.id}>
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">#{inst.instalmentNo}</span>
                      <span className="font-medium text-gray-900">{fmt(inst.amount)}</span>
                      <span className="text-xs text-gray-500">
                        {inst.paidDate ? `Paid ${fmtDate(inst.paidDate)}` : `Due ${fmtDate(inst.dueDate)}`}
                      </span>
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </div>
                    {award.canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => togglePaid(inst.id, !inst.paidDate)}
                          disabled={busyId === inst.id}
                          className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {inst.paidDate ? 'Undo' : 'Mark paid'}
                        </button>
                        <button
                          onClick={() => beginEdit(inst)}
                          className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Edit
                        </button>
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
        await addReportMilestone({ data: { awardId: award.id, label: draftLabel.trim(), dueDate: draftDate } })
      } else if (editId) {
        await updateReportMilestone({ data: { id: editId, label: draftLabel.trim(), dueDate: draftDate } })
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
      <input
        type="date"
        value={draftDate}
        onChange={(e) => setDraftDate(e.target.value)}
        className={inputClass}
      />
      <Button size="sm" onClick={save} disabled={busyId != null || !draftLabel.trim() || !draftDate}>
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
        <h2 className="text-sm font-semibold text-gray-900">Reporting schedule</h2>
        {award.canEdit && !adding && (
          <button onClick={beginAdd} className="text-xs font-medium text-emerald-700 hover:underline">
            + Add date
          </button>
        )}
      </div>

      {award.reportingMilestones.length === 0 && !adding ? (
        <p className="mt-4 text-sm text-gray-400">No reporting dates set.</p>
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
                      <span className="shrink-0 text-xs text-gray-500">
                        {m.submittedDate ? `Received ${fmtDate(m.submittedDate)}` : `Due ${fmtDate(m.dueDate)}`}
                      </span>
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </div>
                    {award.canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => beginEdit(m)}
                          className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        {!m.submittedDate && (
                          <button
                            onClick={() => remove(m.id)}
                            disabled={busyId === m.id}
                            className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
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
        <h2 className="text-sm font-semibold text-gray-900">Reports received</h2>
        <EmptyState className="mt-3 py-8">
          <p className="text-sm text-gray-500">No reports received yet.</p>
          <p className="mt-1 text-xs text-gray-400">
            Submitted reports are matched to this award automatically and will appear here.
          </p>
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card className="px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">Reports received</h2>
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
                      r.status === 'reviewed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                    }
                  >
                    {r.status === 'reviewed' ? 'Reviewed' : 'Received'}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-gray-600">{r.aiSummary ?? r.impactSummary}</p>
              </div>
              <div className="shrink-0 text-right">
                {r.impactQuantity != null && (
                  <p className="text-sm font-semibold text-gray-900">
                    {Number(r.impactQuantity).toLocaleString('en-GB')}
                    {r.impactUnitLabel && (
                      <span className="ml-1 text-xs font-normal text-gray-400">{r.impactUnitLabel}</span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-gray-400">{fmtDate(r.submittedAt)}</p>
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
        <h2 className="text-sm font-semibold text-gray-900">Source application</h2>
        <Link
          to="/applications/$applicationId"
          params={{ applicationId: a.id }}
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          View application →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <Field label="Requested" value={fmt(a.amountRequested)} />
        <Field
          label="Awarded"
          value={fmt(award.amountAwarded)}
          sub={
            uplift === 0
              ? 'as requested'
              : uplift > 0
                ? `${fmt(uplift)} above`
                : `${fmt(-uplift)} below`
          }
        />
        <Field
          label="Custodian score"
          value={
            a.custodianScoreStatus === 'scored' && a.custodianScore != null ? `${a.custodianScore}/100` : '—'
          }
        />
        <Field label="Registration" value={a.charityNumber ?? a.companyNumber ?? '—'} />
        {a.externalApplicationId && <Field label="Their reference" value={a.externalApplicationId} />}
      </div>
    </Card>
  )
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 font-medium text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}
