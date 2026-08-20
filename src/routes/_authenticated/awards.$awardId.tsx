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
  GRANT_STATUS_LABELS,
} from '../../server/fns/applications'
import { resendAwardLetter } from '../../server/fns/awardSetup'
import { AwardLetterPreview } from '../../components/AwardLetterPreview'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  BankIcon,
  Calendar03Icon,
  Coins01Icon,
  Mail01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import {
  Badge,
  Breadcrumb,
  Button,
  DateField,
  DetailHeader,
  Dialog,
  KeyFact,
  KPI_TINTS,
  LinkButton,
  MiniKpi,
  Panel,
  PanelTitle,
  TextLink,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { AREA_ICON } from '../../components/Sidebar'
import { fmtDate, fmtDuration, fmtMoney, fmtRef } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/awards/$awardId')({
  loader: ({ params }) => orNotFound(getAward({ data: { id: params.awardId } })),
  component: AwardDetail,
})

type AwardData = Awaited<ReturnType<typeof getAward>>

/** The lifecycle colour, on the same three values the awards list bands (`GRANT_STATUS_HEX`
 *  there) — a grant's status must not be one colour in the table and another on its page. */
const AWARD_STATUS_HEX: Record<string, string> = {
  active: C.success,
  completed: C.sub,
  cancelled: C.danger,
}

// A line item's own state, as `Badge size="sm"` — the small pill, because these annotate
// one row inside a card rather than saying what the whole record is (see `ui/Badge`).
const SCHED_STATUS = {
  paid: { label: 'Paid', className: 'bg-success/10 text-success' },
  submitted: { label: 'Received', className: 'bg-info/10 text-info' },
  overdue: { label: 'Overdue', className: 'bg-danger/10 text-danger' },
  due_soon: { label: 'Due soon', className: 'bg-warning/10 text-warning' },
  upcoming: { label: 'Upcoming', className: 'bg-grey-100 text-grey-500' },
  tbc: { label: 'Date TBC', className: 'bg-grey-100 text-grey-400' },
}

/**
 * The 32px field the inline editors are built from — the app's wash field surface
 * (`ui/fields`) at the small control box `DateField size="sm"` and `Button size="sm"`
 * already wear, so an editing row is three controls of one height rather than three of
 * three. It is spelled out rather than composed from `FIELD_SURFACE` because `cn` is a
 * plain join: `h-8` appended to a class string that already says `h-10` is a coin toss.
 */
const SM_FIELD =
  'h-8 rounded-chip bg-grey-100 px-2.5 font-display text-body text-grey-900 placeholder:text-grey-500 focus:outline-hidden focus:ring-2 focus:ring-brand/20'

function AwardDetail() {
  const award = Route.useLoaderData()
  const { impact } = award
  const [letterOpen, setLetterOpen] = useState(false)

  // The next instalment out of the door. This is the question a grants team opens a grant
  // to answer, and it used to be buried in a list you had to read down to find the first
  // row without a tick — so it is a headline figure now, and the awarded date (a fact that
  // never changes) moved up into the subline where facts of that kind belong.
  const nextInstalment = award.instalments.find((i) => !i.paidDate) ?? null
  const nextReport = award.reportingMilestones.find((m) => !m.submittedDate) ?? null

  const subline = [
    award.programmeName,
    award.roundName,
    award.deliveryArea,
    // The foundation's own reference, in the header rather than only in the key facts
    // far below: it is how they will look this grant up in their own systems, and it
    // reads in the same place on every screen that names a grantee.
    fmtRef(award.application.externalApplicationId),
    `Awarded ${fmtDate(award.decisionAt)}`,
    fmtDuration(award.durationYears),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb
        items={[
          { label: 'Awards', to: '/awards', search: { roundId: undefined } },
          { label: award.organisationName },
        ]}
      />

      <DetailHeader
        backTo="/awards"
        backSearch={{ roundId: undefined }}
        backLabel="Back to awards"
        name={award.organisationName}
        subline={subline}
        // Toned, not neutral: whether this grant is Active, Complete or Cancelled decides
        // whether money is still moving, and it was arriving in grey.
        status={{
          label: GRANT_STATUS_LABELS[award.status] ?? award.status,
          colour: AWARD_STATUS_HEX[award.status] ?? C.sub,
          tone: 'toned',
        }}
        actions={
          <>
            {/* The area's own glyph, from `AREA_ICON` — a link to an Application wears
                the Applications mark, here and on the report screen. `File01Icon` is
                what "open the raw submission" wears, and using it here said the two
                buttons went to the same kind of place. */}
            <LinkButton
              to="/applications/$applicationId"
              params={{ applicationId: award.application.id }}
              icon={AREA_ICON['/applications']}
            >
              View Application
            </LinkButton>
            {award.letter && (
              <Button variant="tinted" icon={Mail01Icon} onClick={() => setLetterOpen(true)}>
                Award letter
              </Button>
            )}
          </>
        }
      />

      {/* Key figures. Money first, then what is next out of the door, then what came back
          — awarded / paid / next payment / impact reads as the grant's own timeline. */}
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
          // No meter. The supporting line already states the outstanding balance in
          // pounds, which is the number Finance acts on; a bar under it re-stated the
          // same ratio less precisely and made this one tile taller than the three
          // beside it.
          sub={
            award.outstanding > 0 ? `${fmtMoney(award.outstanding)} outstanding` : 'paid in full'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.amber}
          icon={Calendar03Icon}
          label="Next payment"
          value={nextInstalment ? fmtMoney(nextInstalment.amount) : '—'}
          sub={
            nextInstalment
              ? nextInstalment.dueDate
                ? `due ${fmtDate(nextInstalment.dueDate)}`
                : 'date to be confirmed'
              : award.instalmentCount === 0
                ? 'no schedule set up'
                : 'schedule complete'
          }
          valueColour={nextInstalment?.status === 'overdue' ? C.danger : undefined}
        />
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={UserGroupIcon}
          label="Impact reported"
          // The unit is the supporting line rather than the label, so this tile is named
          // by what it means like its neighbours, not by whatever the programme measures.
          value={impact.total != null ? impact.total.toLocaleString('en-GB') : '—'}
          sub={
            impact.total != null
              ? [
                  impact.unitLabel,
                  `across ${impact.reportCount} report${impact.reportCount !== 1 ? 's' : ''}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'no impact reported yet'
          }
        />
      </div>

      {/* What the money is for, in the foundation's own words — the thing a later
          grant report is read against, so it belongs above the mechanics. */}
      <PurposePanel award={award} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentsPanel award={award} />
        <ReportingPanel award={award} nextReport={nextReport} />
      </div>

      <ReportsPanel award={award} />

      <AwardLetterPanel award={award} onRead={() => setLetterOpen(true)} />

      <ApplicationPanel award={award} />

      {award.letter && (
        <Dialog
          open={letterOpen}
          onClose={() => setLetterOpen(false)}
          title="Award letter"
          description={award.letter.subject}
          size="lg"
        >
          <AwardLetterPreview bodyText={award.letter.bodyText} />
        </Dialog>
      )}
    </div>
  )
}

// ─── Purpose and conditions ──────────────────────────────────────────────────

/**
 * "Awarded for", NOT "Grant purpose" — and the rename is the point.
 *
 * `awards.purpose` and `applications.grant_purpose` are two different sentences about
 * one grant, by design: the application's is what the applicant asked for (mapped from
 * their own submission), the award's is what the foundation agreed to fund, written at
 * set-up and printed on the letter as "towards {purpose}". `createAwards` PRE-FILLS the
 * second from the first and then lets the admin reword or replace it, so the two
 * legitimately differ on most grants.
 *
 * Both panels used to be titled "Grant purpose", which made a deliberate distinction
 * read as the same field disagreeing with itself across two screens. The heading is the
 * fix: this one names the decision, the application's names the request.
 */
function PurposePanel({ award }: { award: AwardData }) {
  // One per line, as `renderAwardLetter` numbers them on the letter — a grant set up with
  // three bespoke terms must not read here as one paragraph.
  const bespoke = (award.specialCondition ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!award.purpose && bespoke.length === 0) return null

  return (
    <Panel label="Awarded for">
      <PanelTitle>Awarded for</PanelTitle>
      {award.purpose ? (
        <p className="font-display text-body leading-relaxed" style={{ color: C.ink }}>
          {award.purpose}
        </p>
      ) : (
        <p className="font-display text-body" style={{ color: C.sub }}>
          No purpose was recorded when this grant was set up.
        </p>
      )}
      {bespoke.length > 0 && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: C.wash }}>
          <p className="font-display text-label uppercase tracking-wide" style={{ color: C.faint }}>
            {bespoke.length === 1
              ? 'Condition specific to this grant'
              : 'Conditions specific to this grant'}
          </p>
          <ol className="mt-2 flex flex-col gap-2">
            {bespoke.map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-swatch font-display text-micro font-semibold tabular-nums"
                  style={{ backgroundColor: C.brandBg, color: C.brand }}
                >
                  {i + 1}
                </span>
                <span className="font-display text-body leading-relaxed" style={{ color: C.body }}>
                  {line}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  )
}

// ─── Payments ────────────────────────────────────────────────────────────────

function PaymentsPanel({ award }: { award: AwardData }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftAmount, setDraftAmount] = useState('')

  // A schedule that does not add up to the award is a real problem — the grantee was
  // promised one figure and the payment run will move another — and it is invisible
  // until someone totals the column by eye. Stated where the schedule is edited.
  const shortfall = award.amountAwarded - award.scheduledTotal
  const unreconciled = award.instalmentCount > 0 && Math.abs(shortfall) >= 1

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
    // The panel is the SCHEDULE — a dated line per payment, with the actions that move
    // it. How much has been paid is answered by the stat row above, so it is stated here
    // as a meta line rather than redrawn as a second headline and a second bar: the same
    // ratio drawn twice on one screen is two things to keep in step and nothing gained.
    <Panel label="Payments" className="flex flex-col">
      <PanelTitle
        right={
          <span className="font-display text-label font-medium" style={{ color: C.faint }}>
            {award.paidCount} of {award.instalmentCount} paid · {fmtMoney(award.outstanding)}{' '}
            outstanding
          </span>
        }
      >
        Payments
      </PanelTitle>

      {unreconciled && (
        <p
          className="flex items-start gap-1.5 rounded-chip px-3 py-2 font-display text-label"
          style={{ backgroundColor: C.warningWash, color: C.warning }}
        >
          <HugeiconsIcon icon={Alert02Icon} size={16} color="currentColor" className="shrink-0" />
          <span>
            The schedule totals {fmtMoney(award.scheduledTotal)} —{' '}
            {shortfall > 0 ? `${fmtMoney(shortfall)} less` : `${fmtMoney(-shortfall)} more`} than
            the {fmtMoney(award.amountAwarded)} awarded.
          </span>
        </p>
      )}

      {award.instalments.length === 0 ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          No instalment schedule recorded — nothing is queued to be paid.
        </p>
      ) : (
        <ul className="flex flex-col">
          {award.instalments.map((inst) => {
            const meta = SCHED_STATUS[inst.status] ?? SCHED_STATUS.upcoming
            const editing = editId === inst.id
            return (
              <li
                key={inst.id}
                className="border-t py-2.5 first:border-t-0"
                style={{ borderColor: C.wash }}
              >
                {editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <ScheduleNumber n={inst.instalmentNo} />
                    <input
                      type="number"
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      className={`${SM_FIELD} w-28`}
                      placeholder="Amount"
                      aria-label={`Instalment ${inst.instalmentNo} amount`}
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
                      {busyId === inst.id ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ScheduleNumber n={inst.instalmentNo} />
                      <span
                        className="font-display text-body font-medium tabular-nums"
                        style={{ color: C.ink }}
                      >
                        {fmtMoney(inst.amount)}
                      </span>
                      <span className="truncate font-display text-label" style={{ color: C.sub }}>
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
                          variant={inst.paidDate ? 'ghost' : 'secondary'}
                          size="xs"
                        >
                          {inst.paidDate ? 'Undo' : 'Mark paid'}
                        </Button>
                        <Button onClick={() => beginEdit(inst)} variant="ghost" size="xs">
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
    </Panel>
  )
}

/** The instalment's place in the schedule — a numbered tile rather than "#3", so the
 *  column of numbers reads as an ordered list at a glance. */
function ScheduleNumber({ n }: { n: number }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-chip font-display text-label font-medium tabular-nums"
      style={{ backgroundColor: C.wash, color: C.sub }}
    >
      {n}
    </span>
  )
}

// ─── Reporting schedule ──────────────────────────────────────────────────────

function ReportingPanel({
  award,
  nextReport,
}: {
  award: AwardData
  nextReport: AwardData['reportingMilestones'][number] | null
}) {
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

  const received = award.reportingMilestones.filter((m) => m.submittedDate).length

  const editor = (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <input
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        className={`${SM_FIELD} min-w-40 flex-1`}
        placeholder="Report label (e.g. Interim report)"
        aria-label="Report label"
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
        {busyId != null ? 'Saving…' : 'Save'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
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
    // Payments' twin, and drawn as its twin: title, a meta line, the dated rows. The two
    // sit side by side, so anything one does that the other doesn't reads as a difference
    // in the data rather than a difference in the panel.
    <Panel label="Reporting schedule" className="flex flex-col">
      <PanelTitle
        right={
          <div className="flex items-center gap-3">
            <span className="font-display text-label font-medium" style={{ color: C.faint }}>
              {received} of {award.reportingMilestones.length} received
              {nextReport ? ` · next due ${fmtDate(nextReport.dueDate)}` : ''}
            </span>
            {award.canEdit && !adding && (
              <Button variant="text" size="xs" onClick={beginAdd}>
                + Add a date
              </Button>
            )}
          </div>
        }
      >
        Reporting schedule
      </PanelTitle>

      {award.reportingMilestones.length === 0 && !adding ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          No reporting dates set — nothing is expected back from this grantee.
        </p>
      ) : (
        <ul className="flex flex-col">
          {award.reportingMilestones.map((m) => {
            const meta = SCHED_STATUS[m.status] ?? SCHED_STATUS.upcoming
            return (
              <li key={m.id} className="border-t first:border-t-0" style={{ borderColor: C.wash }}>
                {editId === m.id ? (
                  editor
                ) : (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    {/* Every milestone opens the report screen — `getReport` resolves a
                        schedule row as well as a submission, so a date still awaited has
                        a page too, saying what is expected and when. */}
                    <Link
                      to="/reports/$reportKey"
                      params={{ reportKey: m.id }}
                      className="group flex min-w-0 items-center gap-2.5"
                    >
                      <span
                        className="truncate font-display text-body font-medium group-hover:underline"
                        style={{ color: C.ink }}
                      >
                        {m.label}
                      </span>
                      <span className="shrink-0 font-display text-label" style={{ color: C.sub }}>
                        {m.submittedDate
                          ? `Received ${fmtDate(m.submittedDate)}`
                          : `Due ${fmtDate(m.dueDate)}`}
                      </span>
                      <Badge size="sm" className={meta.className}>
                        {meta.label}
                      </Badge>
                    </Link>
                    {award.canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button onClick={() => beginEdit(m)} variant="ghost" size="xs">
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
    </Panel>
  )
}

// ─── Reports received ────────────────────────────────────────────────────────
//
// Not a duplicate of the reporting schedule above, though both name the same documents.
// The schedule is the ADMIN of reporting — dates, whether they were met, and the controls
// to change them. This is what the reports SAID: the analysis summary and the impact
// figure, which is the half a trustee reads. It is also the only place an unscheduled
// report can appear, since one arriving without a milestone belongs to no row up there.

function ReportsPanel({ award }: { award: AwardData }) {
  if (award.reports.length === 0) {
    return (
      <Panel label="Reports received">
        <PanelTitle>Reports received</PanelTitle>
        <p className="font-display text-body" style={{ color: C.sub }}>
          No reports received yet.
        </p>
        <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
          Submitted reports are matched to this grant automatically and will appear here.
        </p>
      </Panel>
    )
  }

  return (
    <Panel label="Reports received">
      <PanelTitle
        right={
          <span className="font-display text-label font-medium" style={{ color: C.faint }}>
            {award.reports.length} received
          </span>
        }
      >
        Reports received
      </PanelTitle>
      <ul className="flex flex-col">
        {award.reports.map((r) => (
          <li key={r.id} className="border-t first:border-t-0" style={{ borderColor: C.wash }}>
            <Link
              to="/reports/$reportKey"
              params={{ reportKey: r.id }}
              className="group flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="font-display text-body font-medium group-hover:underline"
                    style={{ color: C.ink }}
                  >
                    {r.label}
                  </span>
                  <Badge
                    size="sm"
                    className={
                      r.status === 'reviewed'
                        ? 'bg-success/10 text-success'
                        : 'bg-info/10 text-info'
                    }
                  >
                    {r.status === 'reviewed' ? 'Reviewed' : 'Received'}
                  </Badge>
                </div>
                <p
                  className="mt-1 line-clamp-2 font-display text-body leading-relaxed"
                  style={{ color: C.sub }}
                >
                  {r.aiSummary ?? r.impactSummary}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {r.impactQuantity != null && (
                  <p
                    className="font-display text-title font-medium tabular-nums"
                    style={{ color: C.ink }}
                  >
                    {Number(r.impactQuantity).toLocaleString('en-GB')}
                    {r.impactUnitLabel && (
                      <span
                        className="ml-1 font-display text-label font-normal"
                        style={{ color: C.faint }}
                      >
                        {r.impactUnitLabel}
                      </span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 font-display text-label" style={{ color: C.faint }}>
                  {fmtDate(r.submittedAt)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
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
function AwardLetterPanel({ award, onRead }: { award: AwardData; onRead: () => void }) {
  const router = useRouter()
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
      <Panel label="Award letter">
        <PanelTitle>Award letter</PanelTitle>
        <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
          No letter was issued for this grant. Letters are written and sent during award set-up —
          grants made before that existed, and grants imported from a back catalogue, have none.
        </p>
      </Panel>
    )
  }

  const status = LETTER_STATUS[letter.status] ?? LETTER_STATUS.draft!

  return (
    <Panel label="Award letter">
      <PanelTitle
        right={
          <div className="flex items-center gap-2">
            <Badge className={status.className}>{status.label}</Badge>
            <Button variant="secondary" size="sm" onClick={onRead}>
              Read the letter
            </Button>
            {award.canEdit && (
              <Button variant="tinted" size="sm" onClick={handleResend} disabled={busy}>
                {busy ? 'Sending…' : letter.status === 'sent' ? 'Send again' : 'Send now'}
              </Button>
            )}
          </div>
        }
      >
        Award letter
      </PanelTitle>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <KeyFact label="Sent to" value={letter.recipientEmail ?? 'Nobody — no address'} />
        <KeyFact label="Replies to" value={letter.replyTo ?? '—'} />
        <KeyFact label="Sent" value={letter.sentAt ? fmtDate(letter.sentAt) : 'Not sent'} />
        <KeyFact label="Subject" value={letter.subject} />
      </div>

      {letter.status !== 'sent' && letter.failureReason && (
        <p
          className="mt-3 rounded-chip px-3 py-2 font-display text-label"
          style={{ backgroundColor: C.warningWash, color: C.warning }}
        >
          {letter.failureReason}
        </p>
      )}
      {error && (
        <p
          className="mt-3 rounded-chip px-3 py-2 font-display text-label"
          style={{ backgroundColor: C.dangerWash, color: C.danger }}
        >
          {error}
        </p>
      )}
    </Panel>
  )
}

// ─── Source application ──────────────────────────────────────────────────────

function ApplicationPanel({ award }: { award: AwardData }) {
  const a = award.application
  const uplift = award.amountAwarded - a.amountRequested

  return (
    <Panel label="Source application">
      <PanelTitle
        right={
          <TextLink
            to="/applications/$applicationId"
            params={{ applicationId: a.id }}
            className="text-label"
          >
            View the application →
          </TextLink>
        }
      >
        Source application
      </PanelTitle>
      {/* Four facts, not five: "Their reference" moved up to the header subline, where
          every other screen states it. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-4">
        <KeyFact label="Requested" value={fmtMoney(a.amountRequested)} />
        <KeyFact
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
        <KeyFact
          label="Custodian score"
          value={
            a.custodianScoreStatus === 'scored' && a.custodianScore != null
              ? `${a.custodianScore}/100`
              : '—'
          }
          sub={a.custodianScoreStatus === 'scored' ? 'out of 100' : 'not scored'}
        />
        <KeyFact
          label="Registration"
          value={a.charityNumber ?? a.companyNumber ?? '—'}
          sub={
            a.charityNumber ? 'charity number' : a.companyNumber ? 'company number' : 'none held'
          }
        />
      </div>
    </Panel>
  )
}
