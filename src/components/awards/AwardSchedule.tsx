import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon, Delete02Icon } from '@hugeicons/core-free-icons'
import {
  addReportMilestone,
  deleteReportMilestone,
  setInstalmentPaid,
  updateInstalment,
  updateReportMilestone,
  type getAward,
} from '../../server/fns/applications'
import {
  Badge,
  Button,
  CardTitle,
  DateField,
  ErrorNote,
  Input,
  Label,
  MoneyInput,
  Panel,
  PillTabs,
  StepMarker,
  type PillTabItem,
  type TimelineMarker,
} from '../ui'
import { POPOVER_LAYER, useAnchoredPopover, useDismiss } from '../ui/popover'
import { C } from '../ui/tokens'
import { fmtDate, fmtMoney } from '../../lib/format'
import { impactPhrase } from '../../lib/impactUnits'
import { grantTimeline, type GrantTimelineEntry } from '../../lib/reportTimeline'
import {
  arrivalPhrase,
  inScheduleFilter,
  letterPhrase,
  type ScheduleFilter,
} from '../../lib/awardScreen'

// ─── The grant's schedule ────────────────────────────────────────────────────
//
// The award screen's main card (Figma 1347:1090): the award, every payment and every
// reporting date on ONE line, in the order they happened or fall due — `grantTimeline`,
// the same line the report screen draws in its side column. This one is the working
// copy: it carries the controls that move the grant along (mark paid, edit a payment,
// move a reporting date) and the reports' own first lines.
//
// It replaced two side-by-side panels, Payments and Reporting schedule, plus a third
// listing what the reports said. Money out and reports in are one sequence, and a
// grants officer reading "was the interim report in before we released the second
// payment?" had to hold three lists in their head to answer it.
//
// The filter narrows the rows and nothing else. Hidden rows COLLAPSE rather than being
// unmounted, so the switch animates and the line visibly closes up around what is left.

type AwardData = Awaited<ReturnType<typeof getAward>>
type Instalment = AwardData['instalments'][number]
type Milestone = AwardData['reportingMilestones'][number]
type ReportEntry = Extract<GrantTimelineEntry, { kind: 'report' }>
type InstalmentEntry = Extract<GrantTimelineEntry, { kind: 'instalment' }>

const FILTERS: PillTabItem<ScheduleFilter>[] = [
  { id: 'all', label: 'Everything' },
  { id: 'payments', label: 'Payments' },
  { id: 'reports', label: 'Reports' },
]

// A row's own state, as the pill beside it. `Received` wears the info hue it wears on the
// reports list, so a report is one colour wherever it is named.
const PILL = {
  paid: { label: 'Paid', className: 'bg-success/10 text-success' },
  next: { label: 'Due next', className: 'bg-warning/10 text-warning' },
  overdue: { label: 'Overdue', className: 'bg-danger/10 text-danger' },
  tbc: { label: 'Date TBC', className: 'bg-grey-100 text-grey-500' },
  received: { label: 'Received', className: 'bg-info/10 text-info' },
  reviewed: { label: 'Reviewed', className: 'bg-success/10 text-success' },
  dueSoon: { label: 'Due soon', className: 'bg-warning/10 text-warning' },
  scheduled: { label: 'Scheduled', className: 'bg-grey-200 text-grey-500' },
} as const

function RowPill({ kind }: { kind: keyof typeof PILL }) {
  const p = PILL[kind]
  return <Badge className={`h-6 items-center ${p.className}`}>{p.label}</Badge>
}

export function AwardSchedule({ award }: { award: AwardData }) {
  const [filter, setFilter] = useState<ScheduleFilter>('all')

  const entries = grantTimeline({
    decisionAt: award.decisionAt,
    amountAwarded: award.amountAwarded,
    instalments: award.instalments,
    reporting: award.reporting,
  })
  // The one thing the grant is waiting on next wears the "current" marker, money or
  // report — the report screen's rule, so the two lines mark the same step.
  const nextIdx = entries.findIndex((e) => !e.done)
  // The payment that goes out next. Mark as paid lives on this row only: money leaves in
  // order, and a button on every unpaid row invited ticking off the wrong one. An
  // out-of-order payment is still one click away, inside that row's Edit.
  const nextPaymentId = award.instalments.find((i) => !i.paidDate)?.id ?? null

  const visible = entries.map((e) => inScheduleFilter(e.kind, filter))
  const visibleIdx = visible.flatMap((v, i) => (v ? [i] : []))

  const empty =
    filter === 'payments' && award.instalments.length === 0
      ? 'No instalment schedule is recorded — nothing is queued to be paid.'
      : filter === 'reports' && award.reporting.length === 0
        ? 'No reporting dates are set — nothing is expected back from this grantee.'
        : null

  return (
    <Panel label="Schedule" className="flex flex-col gap-2">
      <CardTitle
        right={<PillTabs items={FILTERS} value={filter} onChange={setFilter} ariaLabel="Show" />}
      >
        Schedule
      </CardTitle>

      <ol className="flex flex-col">
        {entries.map((e, i) => {
          const shown = visible[i]!
          const at = visibleIdx.indexOf(i)
          const marker: TimelineMarker = e.done ? 'done' : i === nextIdx ? 'current' : 'future'
          return (
            <li
              key={e.key}
              // `grid-template-rows` 1fr → 0fr is the one way to animate a row to its
              // content's height and back without measuring it. `inert` takes a hidden
              // row's controls out of the tab order along with the eye.
              className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
              style={{ gridTemplateRows: shown ? '1fr' : '0fr', opacity: shown ? 1 : 0 }}
              aria-hidden={!shown || undefined}
              inert={!shown}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex gap-2">
                  <Rail marker={marker} up={at > 0} down={at >= 0 && at < visibleIdx.length - 1} />
                  <div
                    className={`flex min-w-0 flex-1 flex-wrap justify-between gap-x-4 gap-y-3 py-4 ${
                      e.kind === 'report' ? 'items-start' : 'items-center'
                    } ${at >= 0 && at < visibleIdx.length - 1 ? 'border-b' : ''}`}
                    style={{ borderColor: C.line }}
                  >
                    {e.kind === 'awarded' ? (
                      <AwardedRow award={award} date={e.date} />
                    ) : e.kind === 'instalment' ? (
                      <InstalmentRow award={award} entry={e} isNext={e.key === nextPaymentId} />
                    ) : (
                      <ReportRow award={award} entry={e} />
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {empty && (
        <p className="pl-6 font-display text-body" style={{ color: C.sub }}>
          {empty}
        </p>
      )}

      {award.canEdit && filter !== 'payments' && (
        <div className="pl-6">
          <EditPopover
            label="Add a reporting date"
            trigger={(p) => (
              <Button variant="text" size="xs" {...p}>
                + Add a reporting date
              </Button>
            )}
          >
            {(close) => <MilestoneEditor awardId={award.id} milestone={null} close={close} />}
          </EditPopover>
        </div>
      )}
    </Panel>
  )
}

/**
 * The marker column: the step's dot, and the rule joining it to its neighbours. Drawn
 * as two half-rules per row — up to the dot, and on down from it — so a collapsed row
 * between two visible ones leaves no gap and no stub: each row only draws toward a
 * neighbour that is actually showing.
 */
function Rail({ marker, up, down }: { marker: TimelineMarker; up: boolean; down: boolean }) {
  return (
    <div className="relative w-4 shrink-0">
      {up && (
        <span
          aria-hidden
          className="absolute top-0 left-[7.5px] h-5 w-px"
          style={{ backgroundColor: C.line }}
        />
      )}
      <span className="absolute top-5 left-0">
        <StepMarker kind={marker} />
      </span>
      {down && (
        <span
          aria-hidden
          className="absolute top-9 bottom-0 left-[7.5px] w-px"
          style={{ backgroundColor: C.line }}
        />
      )}
    </div>
  )
}

/** A row's first line: the thing itself, then what is said about it. */
function Headline({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 font-display text-body">
      {children}
    </div>
  )
}

function DateLine({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-label" style={{ color: C.sub }}>
      {children}
    </p>
  )
}

function AwardedRow({ award, date }: { award: AwardData; date: string }) {
  const amount = fmtMoney(award.amountAwarded)
  const said = [
    // "Committed" is the rollups' word for money the foundation no longer has; a
    // cancelled grant is no longer committed, so it is not called that here either.
    award.status === 'cancelled' ? `${amount} · since cancelled` : `${amount} committed`,
    letterPhrase(award.decisionAt, award.letter, fmtDate),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Headline>
        <span className="font-medium" style={{ color: C.ink }}>
          Grant awarded
        </span>
        <span style={{ color: C.sub }}>{said}</span>
      </Headline>
      <DateLine>{fmtDate(date)}</DateLine>
    </div>
  )
}

function InstalmentRow({
  award,
  entry: e,
  isNext,
}: {
  award: AwardData
  entry: InstalmentEntry
  isNext: boolean
}) {
  const inst = award.instalments.find((i) => i.id === e.key)
  if (!inst) return null
  const pill: keyof typeof PILL | null = e.done
    ? 'paid'
    : e.dueStatus === 'overdue'
      ? 'overdue'
      : e.dueStatus === 'tbc'
        ? 'tbc'
        : isNext
          ? 'next'
          : null
  const name = `instalment ${e.n} of ${e.of}`

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <Headline>
          <span className="font-medium tabular-nums" style={{ color: C.ink }}>
            {fmtMoney(e.amount)}
          </span>
          <span style={{ color: C.sub }}>
            Instalment {e.n} of {e.of}
            {e.n === e.of && e.of > 1 ? ' · Final payment' : ''}
          </span>
          {pill && <RowPill kind={pill} />}
        </Headline>
        <DateLine>
          {e.done ? `Paid ${fmtDate(e.date)}` : e.date ? fmtDate(e.date) : 'Date to be confirmed'}
        </DateLine>
      </div>

      {/* Money is admin's and finance's: `finance` exists to run the payment schedule. */}
      {award.canEditPayments && (
        <div className="flex shrink-0 items-center gap-2">
          <EditPopover
            label={`Edit ${name}`}
            trigger={(p) =>
              isNext ? (
                <Button variant="secondary" aria-label={`Edit ${name}`} {...p}>
                  Edit
                </Button>
              ) : (
                <QuietEdit aria-label={`Edit ${name}`} {...p} />
              )
            }
          >
            {(close) => (
              <InstalmentEditor
                award={award}
                inst={inst}
                n={e.n}
                of={e.of}
                isNext={isNext}
                close={close}
              />
            )}
          </EditPopover>
          {isNext && <MarkPaidButton id={inst.id} />}
        </div>
      )}
    </>
  )
}

function ReportRow({ award, entry: e }: { award: AwardData; entry: ReportEntry }) {
  const report = award.reports.find((r) => r.id === e.key || r.scheduleId === e.key) ?? null
  const milestone = award.reportingMilestones.find((m) => m.id === e.key) ?? null
  const pill: keyof typeof PILL = e.received
    ? report?.status === 'reviewed'
      ? 'reviewed'
      : 'received'
    : e.dueStatus === 'overdue'
      ? 'overdue'
      : e.dueStatus === 'due_soon'
        ? 'dueSoon'
        : 'scheduled'
  const timing = e.received && milestone && e.date ? arrivalPhrase(e.date, milestone.dueDate) : null
  const unit = e.impactUnitLabel ?? award.impactUnitLabel
  const said = report?.aiSummary ?? report?.impactSummary ?? null
  const link = { to: '/reports/$reportKey', params: { reportKey: e.key } } as const

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <Headline>
          {e.openable ? (
            <Link {...link} className="font-medium hover:underline" style={{ color: C.ink }}>
              {e.label}
            </Link>
          ) : (
            <span className="font-medium" style={{ color: C.ink }}>
              {e.label}
            </span>
          )}
          <RowPill kind={pill} />
          {timing && <span style={{ color: C.sub }}>{timing}</span>}
        </Headline>
        <DateLine>{fmtDate(e.date)}</DateLine>
        {(said || e.impactQuantity != null) && (
          <p
            className="line-clamp-2 max-w-[60ch] font-display text-body leading-normal"
            style={{ color: C.sub }}
          >
            {e.impactQuantity != null && unit && (
              <>
                Reported{' '}
                <span className="font-medium" style={{ color: C.body }}>
                  {impactPhrase(e.impactQuantity, unit)}
                </span>
                .{' '}
              </>
            )}
            {said}
          </p>
        )}
      </div>

      {/* Reading a report as it was sent is the View submissions card's; the row's own
          title goes to its page, where the analysis and the review live.
          Reporting dates are the admins' — `finance` runs the money, not the reporting. */}
      {!e.received && milestone && award.canEdit && (
        <EditPopover
          label={`Edit ${milestone.label}`}
          trigger={(p) => <QuietEdit aria-label={`Edit ${milestone.label}`} {...p} />}
        >
          {(close) => <MilestoneEditor awardId={award.id} milestone={milestone} close={close} />}
        </EditPopover>
      )}
    </>
  )
}

/** The small grey "Edit" on a row that is not the one in play. */
function QuietEdit(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="flex h-6 items-center rounded-chip px-1 font-display text-label font-medium text-grey-500 hover:text-grey-900 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
      {...props}
    >
      Edit
    </button>
  )
}

function MarkPaidButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function pay() {
    setBusy(true)
    try {
      await setInstalmentPaid({ data: { id, paid: true } })
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button onClick={pay} disabled={busy}>
      {busy ? 'Saving…' : 'Mark as paid'}
    </Button>
  )
}

// ─── The edit popover ────────────────────────────────────────────────────────

/**
 * A row's editor, opened from its Edit and hung off it (Figma 1347:1228), rather than a
 * dialog in the middle of the screen: the row it changes stays in view beside it. The
 * calendar a date field opens is a layer ABOVE this one, and `useDismiss` knows to
 * leave it be — see `POPOVER_LAYER`.
 */
function EditPopover({
  label,
  trigger,
  children,
}: {
  label: string
  trigger: (props: {
    onClick: () => void
    'aria-expanded': boolean
    'aria-haspopup': 'dialog'
  }) => ReactNode
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPopover(open, rootRef, panelRef, false, 'end')

  // Closing hands focus back to the Edit that opened it, or a keyboard user's next Tab
  // starts again from the top of the page.
  const close = useCallback(() => {
    setOpen(false)
    rootRef.current?.querySelector<HTMLElement>('button, a')?.focus()
  }, [])
  useDismiss(open, close, rootRef, panelRef)

  // Into the first field once the panel is placed — what the reader opened it to change.
  const placed = pos != null
  useEffect(() => {
    if (placed) {
      panelRef.current?.querySelector<HTMLElement>('input:not([tabindex="-1"]), button')?.focus()
    }
  }, [placed])

  return (
    <span ref={rootRef} className="inline-flex">
      {trigger({
        onClick: () => (open ? close() : setOpen(true)),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            {...POPOVER_LAYER}
            role="dialog"
            aria-label={label}
            className="fixed z-[60] flex w-[380px] max-w-[calc(100vw-16px)] flex-col gap-6 rounded-control border bg-white p-4 shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)]"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              borderColor: C.line,
              // Hidden until measured, so it never paints for a frame in the corner.
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  )
}

function EditorTitle({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-body font-medium" style={{ color: C.ink }}>
      {children}
    </p>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

/** The amber note inside an editor — what the change will do that it does not show. */
function Caution({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-chip px-3 py-2 font-display text-label leading-normal"
      style={{ backgroundColor: C.warningWash, color: C.warning }}
    >
      <HugeiconsIcon
        icon={AlertCircleIcon}
        size={14}
        color="currentColor"
        className="mt-0.5 shrink-0"
      />
      <span>{children}</span>
    </p>
  )
}

/** Runs one of an editor's writes: busy while it runs, refreshed and closed once it has. */
function useEditorAction(close: () => void) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  async function run(kind: string, write: () => Promise<unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await write()
      await router.invalidate()
      close()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run }
}

/**
 * An instalment's amount and date — the same two fields the schedule has always been
 * edited by, and nothing moves but the one instalment. A schedule that stops adding up
 * to the award is said so BEFORE it is saved (and after, in the payments card), rather
 * than silently rebalanced: which instalment should absorb the difference is the
 * foundation's call.
 */
function InstalmentEditor({
  award,
  inst,
  n,
  of,
  isNext,
  close,
}: {
  award: AwardData
  inst: Instalment
  n: number
  of: number
  isNext: boolean
  close: () => void
}) {
  const [amount, setAmount] = useState(String(inst.amount))
  const [dueDate, setDueDate] = useState(inst.dueDate ?? '')
  const { busy, error, run } = useEditorAction(close)

  const value = Number(amount)
  const valid = amount !== '' && Number.isFinite(value) && value > 0
  const changed = valid && Math.abs(value - inst.amount) >= 0.005
  const total = award.scheduledTotal - inst.amount + (valid ? value : inst.amount)
  const gap = award.amountAwarded - total

  const save = () =>
    run('save', () =>
      updateInstalment({
        data: { id: inst.id, amount: changed ? value : undefined, dueDate: dueDate || null },
      }),
    )
  const togglePaid = () =>
    run('paid', () => setInstalmentPaid({ data: { id: inst.id, paid: !inst.paidDate } }))

  return (
    <>
      <div className="flex flex-col gap-4">
        <EditorTitle>
          Edit instalment {n} of {of}
        </EditorTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field id={`amount-${inst.id}`} label="Amount">
            <MoneyInput
              id={`amount-${inst.id}`}
              label="Amount"
              value={amount}
              onChange={setAmount}
            />
          </Field>
          <Field id={`due-${inst.id}`} label="Due date">
            <DateField
              id={`due-${inst.id}`}
              value={dueDate}
              onChange={setDueDate}
              aria-label="Due date"
            />
          </Field>
        </div>
        {inst.paidDate && (
          <p className="font-display text-label" style={{ color: C.sub }}>
            Paid {fmtDate(inst.paidDate)}.
          </p>
        )}
        {changed && Math.abs(gap) >= 1 && (
          <Caution>
            The schedule will then total {fmtMoney(total)} —{' '}
            {gap > 0 ? `${fmtMoney(gap)} less` : `${fmtMoney(-gap)} more`} than the{' '}
            {fmtMoney(award.amountAwarded)} awarded.
          </Caution>
        )}
        <ErrorNote error={error} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* Undoing a payment ticked by mistake, and paying one out of turn, both live
            here — the row itself only offers the payment that is due next. */}
        {inst.paidDate || !isNext ? (
          <Button variant="text" size="xs" onClick={togglePaid} disabled={busy != null}>
            {busy === 'paid' ? 'Saving…' : inst.paidDate ? 'Mark as unpaid' : 'Mark as paid'}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || busy != null}>
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </>
  )
}

/** A reporting date: what it is called and when it is due. `milestone` null = adding one. */
function MilestoneEditor({
  awardId,
  milestone,
  close,
}: {
  awardId: string
  milestone: Milestone | null
  close: () => void
}) {
  const [label, setLabel] = useState(milestone?.label ?? '')
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? '')
  const { busy, error, run } = useEditorAction(close)
  const valid = label.trim() !== '' && dueDate !== ''
  const id = milestone?.id ?? 'new'

  const save = () =>
    run('save', () =>
      milestone
        ? updateReportMilestone({ data: { id: milestone.id, label: label.trim(), dueDate } })
        : addReportMilestone({ data: { awardId, label: label.trim(), dueDate } }),
    )
  const remove = () =>
    milestone && run('remove', () => deleteReportMilestone({ data: { id: milestone.id } }))

  return (
    <>
      <div className="flex flex-col gap-4">
        <EditorTitle>{milestone ? `Edit ${milestone.label}` : 'Add a reporting date'}</EditorTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field id={`label-${id}`} label="Report">
            <Input
              id={`label-${id}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Interim report"
            />
          </Field>
          <Field id={`report-due-${id}`} label="Due date">
            <DateField
              id={`report-due-${id}`}
              value={dueDate}
              onChange={setDueDate}
              required
              aria-label="Due date"
            />
          </Field>
        </div>
        <ErrorNote error={error} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* Only a date nothing has answered yet can go — `deleteReportMilestone` refuses
            one a report arrived against, and this never offers it. */}
        {milestone && !milestone.submittedDate ? (
          <Button
            variant="text"
            size="xs"
            icon={Delete02Icon}
            onClick={remove}
            disabled={busy != null}
            style={{ color: C.danger }}
          >
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || busy != null}>
            {busy === 'save' ? 'Saving…' : milestone ? 'Save changes' : 'Add date'}
          </Button>
        </div>
      </div>
    </>
  )
}
