import { createFileRoute, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { parseReportsSearch } from '../../lib/listSearch'
import { useEffect, useState } from 'react'
import { getReport, markReportReviewed, type ReportRowStatus } from '../../server/fns/reports'
import { ReportSubmissionDialog } from '../../components/ReportSubmissionDialog'
import { File01Icon, Mail01Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshLink } from '../../components/RefreshLink'
import { WrongGrantDialog } from '../../components/reports/WrongGrantDialog'
import {
  grantMilestones,
  moveReportFn,
  rerunReportAnalysisFn,
  setReportImpactFn,
} from '../../server/fns/reportCorrections'
import {
  AlignmentCards,
  AlignmentSummary,
  FlagsCard,
  PromisesCard,
  ReportAnalysisCard,
  type ReportAnalysisStatus,
} from '../../components/reportAnalysis'
import {
  AnchorButton,
  BreadcrumbBar,
  Button,
  CardTitle,
  ClampToggle,
  DetailHeader,
  DetailRow,
  Dot,
  EmptyState,
  Input,
  Label,
  Panel,
  RelatedLink,
  Select,
  ThemePills,
  Timeline,
  Tooltip,
  useClamp,
  type TimelineStep,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { AREA_ICON } from '../../components/Sidebar'
import { fmtDate, fmtMoney, fmtRef } from '../../lib/format'
import { formatDecileRange } from '../../lib/deprivation/types'
import { impactPhrase } from '../../lib/impactUnits'
import { againstProposal, grantTimeline, impactToDate } from '../../lib/reportTimeline'
import { MAILTO_LINK, mailtoHref } from '../../lib/mailto'

export const Route = createFileRoute('/_authenticated/reports/$reportKey')({
  // Not this screen's state — the LIST's, carried in by the row that was clicked so the
  // back arrow returns to the tab and filters the reader left. See `lib/listSearch`.
  validateSearch: parseReportsSearch,
  loader: ({ params }) => orNotFound(getReport({ data: { key: params.reportKey } })),
  component: ReportDetail,
})

type ReportData = Awaited<ReturnType<typeof getReport>>

const STATUS_LABELS: Record<ReportRowStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  received: 'Received',
  reviewed: 'Reviewed',
}

// The same five hues the reports list bands its rows with — a report must not be one
// colour in the table and another on its own page.
const STATUS_HEX: Record<ReportRowStatus, string> = {
  overdue: C.danger,
  due_soon: C.warning,
  upcoming: C.sub,
  received: C.info,
  reviewed: C.success,
}

function ReportDetail() {
  const report = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  /* The list's state, riding through so the way out restores it — which tab above all:
     a report reviewed from the Awaiting tab must not drop the reader back on To review.
     `{}` when the reader arrived from anywhere else. */
  const listSearch = Route.useSearch()
  const router = useRouter()
  const s = report.submission
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  // Corrections (admins, on a report that arrived rather than one the import recorded).
  const canCorrect = report.canCorrect
  const [moving, setMoving] = useState(false)
  const [editingImpact, setEditingImpact] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)

  async function rerun() {
    if (!s) return
    setRerunning(true)
    setCorrectionError(null)
    try {
      await rerunReportAnalysisFn({ data: { reportId: s.id } })
      await router.invalidate()
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setRerunning(false)
    }
  }
  const canReview = user.role === 'admin' || user.role === 'superadmin'
  const isReviewed = Boolean(s?.reviewedAt)

  const grantAmount = Number(report.grant.amountAwarded)

  async function handleReview() {
    if (!s) return
    setReviewing(true)
    try {
      await markReportReviewed({ data: { id: s.id, reviewed: !isReviewed } })
      await router.invalidate()
    } finally {
      setReviewing(false)
    }
  }

  const subline = [
    report.label,
    report.programmeName,
    report.roundName,
    fmtRef(report.reference),
    `${fmtMoney(grantAmount)} awarded ${fmtDate(report.grant.decisionAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const analysis = s
    ? {
        aiSummary: s.aiSummary,
        aiChallenges: s.aiChallenges,
        aiLessons: s.aiLessons,
        applicationAlignment: s.applicationAlignment,
        programmeAlignment: s.programmeAlignment,
        impactQuantity: s.impactQuantity,
        impactQuantitySource: s.impactQuantitySource,
        impactQuantityQuote: s.impactQuantityQuote,
        flags: s.flags,
      }
    : null
  const analysed = s?.analysisStatus === 'analysed' && analysis != null

  // The report's figure, set against what the application proposed for the WHOLE grant
  // — so it is measured with every report up to this one added in, or an interim report
  // reads as a shortfall. See `impactToDate`.
  const impactQuantity = s?.impactQuantity != null ? Number(s.impactQuantity) : null
  const comparison =
    s && impactQuantity != null
      ? againstProposal(impactToDate(report.reporting, s.submittedAt), report.proposedImpact, {
          reported: s.impactUnitLabel,
          proposed: report.impactUnitLabel,
        })
      : null

  return (
    <div className="flex flex-col gap-4">
      {/* The two records this report hangs off are onward NAVIGATION, so they ride the
          breadcrumb row rather than the header's action cluster — see `RelatedLink`.
          Each wears its DESTINATION's area glyph, from `AREA_ICON`. */}
      <BreadcrumbBar
        items={[
          // The crumb is the same gesture as the back arrow below it, so it carries the
          // same list state.
          { label: 'Reports', to: '/reports', search: listSearch },
          { label: `${report.organisationName} · ${report.label}` },
        ]}
        related={
          <>
            <RelatedLink
              to="/applications/$applicationId"
              params={{ applicationId: report.applicationId }}
              icon={AREA_ICON['/applications']}
            >
              Application
            </RelatedLink>
            <RelatedLink
              to="/awards/$awardId"
              params={{ awardId: report.grant.id }}
              icon={AREA_ICON['/awards']}
            >
              Award
            </RelatedLink>
          </>
        }
      />

      <DetailHeader
        backTo="/reports"
        /* Back to the LIST AS IT WAS — tab, programme, round, theme, sort, page. Empty
           when the reader arrived from a grant or the dashboard, which lands on the
           plain list as before. */
        backSearch={listSearch}
        backLabel="Back to reports"
        name={report.organisationName}
        subline={subline}
        status={{ label: STATUS_LABELS[report.status], colour: STATUS_HEX[report.status] }}
        // Only what acts on THIS report — the two records it hangs off are on the
        // breadcrumb row above, where onward navigation belongs.
        actions={
          <>
            {/* A plain mailto into the grants team's own client — to chase a report
                that is late, or to answer one that raised a question. */}
            {report.applicantEmail && (
              // `control`: the address describes a link that already names itself —
              // no extra tab stop, and the description lands on the anchor where a
              // screen reader will actually read it.
              <Tooltip
                control
                label="Grantee email address"
                trigger={
                  <AnchorButton
                    icon={Mail01Icon}
                    href={mailtoHref(report.applicantEmail, {
                      subject: `${report.label} for your grant${
                        report.reference ? ` (${report.reference})` : ''
                      }`,
                    })}
                    {...MAILTO_LINK}
                  >
                    Email grantee
                  </AnchorButton>
                }
              >
                {report.applicantEmail}
              </Tooltip>
            )}
            {/* "View Report" is what the application screen calls the same gesture —
                open the thing exactly as it was sent, before anything we made of it — and
                both header buttons wear that screen's styles (Email plain, View tinted,
                each with its icon), so the two records read as one app. */}
            {s && (
              <Button variant="tinted" icon={File01Icon} onClick={() => setSubmissionOpen(true)}>
                View Report
              </Button>
            )}
            {s &&
              canReview &&
              (() => {
                const reviewButton = (
                  <Button
                    variant={isReviewed ? 'secondary' : 'primary'}
                    onClick={handleReview}
                    disabled={reviewing}
                  >
                    {reviewing ? '…' : isReviewed ? 'Undo review' : 'Mark as Reviewed'}
                  </Button>
                )
                // Only worn once there IS a reviewer to name — a tooltip that opens on
                // nothing teaches people the ones that do carry something aren't worth
                // opening either.
                return isReviewed && s.reviewedBy ? (
                  <Tooltip control label="Who reviewed this report" trigger={reviewButton}>
                    Marked as reviewed by {s.reviewedBy}
                  </Tooltip>
                ) : (
                  reviewButton
                )
              })()}
          </>
        }
      />

      {/* Two columns from `xl`: below that the side column would squeeze the report to
          a strip, so it drops beneath instead. `minmax(0, …)` so a long word in the
          report cannot push the grid wider than the screen. */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {!s ? (
            // Nothing has arrived, so there is no analysis to draw and nothing to review.
            // The dashed empty state stands on its own rather than inside a panel: a
            // panel would be a titled section whose entire content is "there isn't one".
            <EmptyState>
              <p className="font-display text-body font-medium" style={{ color: C.ink }}>
                {report.status === 'overdue'
                  ? `${report.label} was due ${fmtDate(report.dueDate)} and has not arrived.`
                  : `${report.label} has not been received yet.`}
              </p>
              <p className="mt-1 font-display text-label" style={{ color: C.sub }}>
                Reports submitted through the grantee form are matched to this grant automatically
                and appear here.
              </p>
            </EmptyState>
          ) : (
            <>
              {correctionError && (
                <p className="font-display text-label" style={{ color: C.danger }} role="alert">
                  {correctionError}
                </p>
              )}
              <ReportAnalysisCard
                status={s.analysisStatus as ReportAnalysisStatus}
                analysis={analysis}
                analysedAt={s.analysedAt}
                runningAction={<RefreshLink />}
                // Re-run is offered after the report MOVES (the analysis compared it with
                // the grant it was on) or after a failed run, at most five a day: see
                // `reportRerunBlocker`. At the cap it stays, disabled, saying why.
                headerAction={
                  !canCorrect ? undefined : report.rerunBlocked === null ? (
                    <Button size="sm" disabled={rerunning} onClick={rerun}>
                      {rerunning ? 'Starting…' : 'Re-run analysis'}
                    </Button>
                  ) : report.rerunBlocked.code === 'capped' ? (
                    <Tooltip
                      label="Why re-running is unavailable"
                      trigger={
                        <Button size="sm" disabled>
                          Re-run analysis
                        </Button>
                      }
                    >
                      {report.rerunBlocked.message}
                    </Tooltip>
                  ) : undefined
                }
                impactAction={
                  canCorrect && !editingImpact ? (
                    <button
                      type="button"
                      aria-label="Edit the milestone and impact figure"
                      onClick={() => setEditingImpact(true)}
                      className="absolute right-2.5 top-2.5 z-20 inline-flex size-7 items-center justify-center rounded-chip border bg-white opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                      style={{ borderColor: C.line, color: C.body }}
                    >
                      <HugeiconsIcon icon={PencilEdit01Icon} size={14} strokeWidth={1.8} />
                    </button>
                  ) : undefined
                }
                impactEditor={
                  editingImpact ? (
                    <ReportPanelEditor
                      reportId={s.id}
                      awardId={report.grant.id}
                      scheduleId={s.scheduleId}
                      scheduleLabel={
                        s.scheduleId
                          ? `${report.label}${report.dueDate ? ` · due ${fmtDate(report.dueDate)}` : ''}`
                          : null
                      }
                      current={impactQuantity}
                      unit={s.impactUnitLabel ?? report.impactUnitLabel}
                      onDone={() => setEditingImpact(false)}
                    />
                  ) : undefined
                }
                impact={{
                  title: report.label,
                  context:
                    [report.programmeName, report.roundName].filter(Boolean).join(' · ') || null,
                  quantity: impactQuantity,
                  unit: s.impactUnitLabel ?? report.impactUnitLabel,
                  comparison,
                  unread: report.asSent?.unreadFigure?.answer ?? null,
                }}
              />
              {analysed && (
                <>
                  <AlignmentCards analysis={analysis} />
                  <PromisesCard analysis={analysis} />
                  <FlagsCard flags={analysis.flags} />
                </>
              )}
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <PurposeCard grant={report.grant} />
          <GrantDetailsCard
            report={report}
            onWrongGrant={s && canCorrect ? () => setMoving(true) : undefined}
          />
          {analysed && <AlignmentSummary analysis={analysis} />}
          <TimelineCard report={report} />
        </div>
      </div>

      {s && canCorrect && (
        <WrongGrantDialog
          open={moving}
          onClose={() => setMoving(false)}
          reportId={s.id}
          organisationName={report.organisationName}
          currentAwardId={report.grant.id}
          milestoneLabel={s.scheduleId ? report.label : null}
          canSendBack={report.asSent !== null}
        />
      )}

      {s && (
        <ReportSubmissionDialog
          open={submissionOpen}
          onClose={() => setSubmissionOpen(false)}
          description={`${report.organisationName} · ${report.label}`}
          fields={s}
          asSent={report.asSent}
          figure={{
            quantity: impactQuantity,
            source: s.impactQuantitySource,
            unit: s.impactUnitLabel ?? report.impactUnitLabel,
          }}
        />
      )}
    </div>
  )
}

// ─── Side column ─────────────────────────────────────────────────────────────

/**
 * What the money is for — the thing this report is read against. The AWARD's purpose
 * (printed on the award letter), falling back to the application's sentence for an award
 * minted before that column existed. Titled "Grant purpose" either way, as on the award
 * and application screens. Clamped: a purpose is usually a sentence, but it is
 * free text, and a side-column card has no business being a page tall.
 */
function PurposeCard({ grant }: { grant: ReportData['grant'] }) {
  const clamp = useClamp(grant.purpose, 4)
  if (!grant.purpose) return null
  return (
    <Panel label="Grant purpose" className="flex flex-col gap-4">
      <CardTitle
        right={
          clamp.clipped || clamp.open ? (
            <ClampToggle open={clamp.open} onToggle={clamp.toggle} label="Read the full purpose" />
          ) : undefined
        }
      >
        Grant purpose
      </CardTitle>
      <p
        ref={clamp.ref}
        className={`font-display text-body leading-normal ${clamp.className ?? ''}`}
        style={{ color: C.body }}
      >
        {grant.purpose}
      </p>
    </Panel>
  )
}

function GrantDetailsCard({
  report,
  onWrongGrant,
}: {
  report: ReportData
  /** An admin's way out when the report is on a grant it is not about. */
  onWrongGrant?: () => void
}) {
  const { grant, themes } = report
  const years = grant.durationYears
  const dash = <span style={{ color: C.faint }}>--</span>

  return (
    <Panel label="Grant details" className="flex flex-col gap-4">
      <CardTitle
        right={
          onWrongGrant ? (
            <button
              type="button"
              onClick={onWrongGrant}
              className="font-display text-label font-medium underline-offset-2 hover:underline"
              style={{ color: C.brand }}
            >
              Wrong grant?
            </button>
          ) : undefined
        }
      >
        Grant details
      </CardTitle>
      <dl className="flex flex-col gap-4">
        <DetailRow label="Award">
          {fmtMoney(Number(grant.amountAwarded))}
          {years != null && years > 0 && (
            <span className="whitespace-nowrap font-normal" style={{ color: C.sub }}>
              <Dot />
              {years === 1 ? 'single year' : `over ${years} years`}
            </span>
          )}
        </DetailRow>
        <DetailRow label="Round">{report.roundName ?? dash}</DetailRow>
        <DetailRow label="Programme">{report.programmeName ?? dash}</DetailRow>
        <DetailRow label="Themes">
          {themes.length === 0 ? dash : <ThemePills themes={themes} />}
        </DetailRow>
        <DetailRow label="Impact measured in">{report.impactUnitLabel ?? dash}</DetailRow>
        <DetailRow label="Community context">
          {report.deprivation ? formatDecileRange(report.deprivation) : dash}
        </DetailRow>
      </dl>
    </Panel>
  )
}

/**
 * The grant as one line — the award, every payment and every reporting date, in the order
 * they happened or fall due, with this report marked in place. The design drew reporting
 * and payments as two cards, with "Grant awarded" heading the reporting one only, so a
 * grant with one report had a two-step line whose first step was not a report. Money out
 * and reports in are one sequence; the order is what a reader wants from it. The rules
 * are `grantTimeline`'s.
 */
function TimelineCard({ report }: { report: ReportData }) {
  const entries = grantTimeline({
    decisionAt: report.grant.decisionAt,
    amountAwarded: Number(report.grant.amountAwarded),
    instalments: report.grant.instalments,
    reporting: report.reporting,
  })
  // The one thing the grant is waiting on next wears the "current" marker, whether it is
  // money or a report — the earliest entry not yet done.
  const nextIdx = entries.findIndex((e) => !e.done)

  const steps = entries.map((e, i): TimelineStep => {
    const marker = e.done ? 'done' : i === nextIdx ? 'current' : 'future'
    if (e.kind === 'awarded') {
      return {
        key: e.key,
        title: 'Grant awarded',
        sub: `${fmtDate(e.date)} · ${fmtMoney(e.amount)}`,
        marker,
      }
    }
    if (e.kind === 'instalment') {
      const overdue = e.dueStatus === 'overdue'
      const amount = fmtMoney(e.amount)
      return {
        key: e.key,
        title: `Instalment ${e.n} of ${e.of}`,
        sub: e.done
          ? `Paid ${fmtDate(e.date)} · ${amount}`
          : e.date
            ? `Due ${fmtDate(e.date)} · ${amount}${overdue ? ' · overdue' : ''}`
            : `Date to be confirmed · ${amount}`,
        urgent: overdue,
        marker,
      }
    }
    const unit = e.impactUnitLabel ?? report.impactUnitLabel
    const overdue = e.dueStatus === 'overdue'
    return {
      key: e.key,
      title: e.here ? `${e.label} (you are here)` : e.label,
      sub: e.received
        ? [
            `Received ${fmtDate(e.date)}`,
            e.impactQuantity != null && unit ? impactPhrase(e.impactQuantity, unit) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : `Due ${fmtDate(e.date)}${overdue ? ' · overdue' : ''}`,
      urgent: overdue,
      marker,
      link: e.openable ? { to: '/reports/$reportKey', params: { reportKey: e.key } } : undefined,
    }
  })

  // The report being read is always on the line, so the one absence it cannot show by
  // itself is a grant set up with no payments — which would just read as a short line.
  const here = entries.findIndex((e) => e.kind === 'report' && e.here)

  return (
    <Panel label="Timeline" className="flex flex-col gap-4">
      <CardTitle>Timeline</CardTitle>
      <Timeline steps={steps} anchor={Math.max(here, 0)} />
      {report.grant.instalments.length === 0 && (
        <p className="font-display text-label" style={{ color: C.sub }}>
          No instalment schedule is recorded for this grant.
        </p>
      )}
    </Panel>
  )
}

/**
 * The figure panel's editor: which milestone this report answers, and its impact
 * figure. One pencil for the panel, because the panel shows both (the milestone on the
 * left, the figure on the right), as an application's cards open all they show.
 *
 * The milestone list is this grant's only; a report on the wrong grant is "Wrong
 * grant?" on the Grant details card. The figure is the one number from a report that
 * Insights totals, read by the model from prose and so sometimes missing or wrong;
 * saved as corrected by hand, which no re-run replaces. Empty means "this report
 * evidences no figure", which is a statement too. Only what changed is saved.
 */
function ReportPanelEditor({
  reportId,
  awardId,
  scheduleId,
  scheduleLabel,
  current,
  unit,
  onDone,
}: {
  reportId: string
  awardId: string
  scheduleId: string | null
  /** The milestone it answers now, so the field shows it before the list arrives. */
  scheduleLabel: string | null
  current: number | null
  unit: string | null
  onDone: () => void
}) {
  const router = useRouter()
  const [value, setValue] = useState(current != null ? String(current) : '')
  const [milestone, setMilestone] = useState(scheduleId ?? 'none')
  const [milestones, setMilestones] = useState<Array<{
    id: string
    label: string
    dueDate: string
    taken: boolean
  }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    grantMilestones({ data: { reportId, awardId } })
      .then(setMilestones)
      .catch(() => {
        setMilestones([])
        setError('The milestones could not be loaded. Cancel and try again.')
      })
  }, [reportId, awardId])

  async function save() {
    const text = value.trim().replace(/[,\s]/g, '')
    const quantity = text === '' ? null : Number(text)
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
      setError('The figure must be a number, such as 120.')
      return
    }
    const nextSchedule = milestone === 'none' ? null : milestone
    setBusy(true)
    setError(null)
    try {
      if (nextSchedule !== scheduleId) {
        await moveReportFn({ data: { reportId, awardId, scheduleId: nextSchedule } })
      }
      if (quantity !== current) {
        await setReportImpactFn({ data: { reportId, quantity } })
      }
      await router.invalidate()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const listed = (milestones ?? [])
    .filter((m) => !m.taken)
    .map((m) => ({ value: m.id, label: `${m.label} · due ${fmtDate(m.dueDate)}` }))
  // The current milestone is always an option, loaded or not, so the field never opens
  // blank on the value it already has.
  const currentOption =
    scheduleId && scheduleLabel && !listed.some((o) => o.value === scheduleId)
      ? [{ value: scheduleId, label: scheduleLabel }]
      : []
  const options = [
    ...currentOption,
    ...listed,
    { value: 'none', label: 'No milestone (an extra report)' },
  ]

  // The same editing card as an application's fields: white with a brand edge, so the
  // (grey) fields read as fields rather than disappearing into the grey figure panel.
  return (
    <div
      className="flex flex-col gap-4 rounded-pill border bg-white p-4 font-display"
      style={{ borderColor: C.brandBorder, boxShadow: `0 0 0 3px ${C.brandBg}` }}
    >
      <p className="text-body font-medium" style={{ color: C.ink }}>
        Milestone and impact figure
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-milestone">Reporting milestone</Label>
        <Select
          id="report-milestone"
          value={milestone}
          options={options}
          onChange={(v: string) => setMilestone(v)}
          disabled={busy}
        />
        <p className="text-label" style={{ color: C.sub }}>
          Milestones another report already answers are not offered. The one this report leaves is
          marked outstanding again.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-figure">Impact figure</Label>
        <div className="flex items-center gap-2">
          <Input
            id="report-figure"
            className="w-40"
            inputMode="decimal"
            value={value}
            placeholder="--"
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
          {unit && (
            <span className="text-label" style={{ color: C.sub }}>
              {unit.charAt(0).toLowerCase() + unit.slice(1)}
            </span>
          )}
        </div>
        <p className="text-label" style={{ color: C.sub }}>
          Leave empty if this report evidences no figure.
        </p>
      </div>
      {error && (
        <p className="text-label" style={{ color: C.danger }} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
