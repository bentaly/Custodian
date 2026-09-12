import { createFileRoute, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { parseReportsSearch } from '../../lib/listSearch'
import { useState } from 'react'
import { getReport, markReportReviewed, type ReportRowStatus } from '../../server/fns/reports'
import { ReportFields } from '../../components/ReportFields'
import { File01Icon, Mail01Icon } from '@hugeicons/core-free-icons'
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
  Dialog,
  Dot,
  EmptyState,
  Panel,
  RelatedLink,
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
                    href={`mailto:${encodeURIComponent(report.applicantEmail)}?subject=${encodeURIComponent(
                      `${report.label} for your grant${
                        report.reference ? ` (${report.reference})` : ''
                      }`,
                    )}`}
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
              <ReportAnalysisCard
                status={s.analysisStatus as ReportAnalysisStatus}
                analysis={analysis}
                analysedAt={s.analysedAt}
                impact={{
                  title: report.label,
                  context:
                    [report.programmeName, report.roundName].filter(Boolean).join(' · ') || null,
                  quantity: impactQuantity,
                  unit: s.impactUnitLabel ?? report.impactUnitLabel,
                  comparison,
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
          <GrantDetailsCard report={report} />
          {analysed && <AlignmentSummary analysis={analysis} />}
          <TimelineCard report={report} />
        </div>
      </div>

      {s && (
        <Dialog
          open={submissionOpen}
          onClose={() => setSubmissionOpen(false)}
          title="Grant report"
          description={`${report.organisationName} · ${report.label}`}
          size="lg"
        >
          <ReportFields report={s} />
        </Dialog>
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

function GrantDetailsCard({ report }: { report: ReportData }) {
  const { grant, themes } = report
  const years = grant.durationYears
  const dash = <span style={{ color: C.faint }}>—</span>

  return (
    <Panel label="Grant details" className="flex flex-col gap-4">
      <CardTitle>Grant details</CardTitle>
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
      title: e.here ? `${e.label} — you are here` : e.label,
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
