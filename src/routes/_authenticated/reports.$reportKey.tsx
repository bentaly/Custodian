import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { useState } from 'react'
import { getReport, markReportReviewed, type ReportRowStatus } from '../../server/fns/reports'
import { ReportFields } from '../../components/ReportFields'
import { ReportAnalysisPanel, type ReportAnalysisStatus } from '../../components/reportAnalysis'
import { ProgressBar } from '../../components/ProgressBar'
import {
  Calendar03Icon,
  Coins01Icon,
  DocumentAttachmentIcon,
  File01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import {
  Badge,
  Breadcrumb,
  Button,
  DetailHeader,
  Dialog,
  EmptyState,
  KPI_TINTS,
  LinkButton,
  MiniKpi,
  Panel,
  PanelTitle,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { fmtDate, fmtMoney } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/reports/$reportKey')({
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

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How the arrival compares with the date it was asked for. A received date on its own
 * says nothing a reader can act on; "11 days late" is the fact that belongs in a grantee
 * conversation, and it is arithmetic nobody should be doing in their head off two dates
 * printed in different places on the screen.
 */
function timeliness(submittedAt: string, dueDate: string | null): string {
  if (!dueDate) return 'no date was set'
  const days = Math.round(
    (new Date(submittedAt).setHours(0, 0, 0, 0) - new Date(dueDate).setHours(0, 0, 0, 0)) / DAY_MS,
  )
  if (days > 1) return `${days} days late`
  if (days === 1) return '1 day late'
  if (days === 0) return 'on the day it was due'
  if (days === -1) return '1 day early'
  return `${-days} days early`
}

function ReportDetail() {
  const report = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const s = report.submission
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const canReview = user.role === 'admin' || user.role === 'superadmin'
  const isReviewed = Boolean(s?.reviewedAt)

  // Where this report sits in the grant's whole reporting story: the siblings already in,
  // plus this one, over everything the schedule asks for. A report is read as one of a
  // series far more often than on its own.
  //
  // `siblings` and `outstanding` both EXCLUDE the milestone on screen, so the one being
  // read has to be added back on whichever side it belongs to — otherwise a grant with
  // four reporting dates says "1 of 3" while you are looking at the fourth.
  const receivedCount = report.siblings.length + (s ? 1 : 0)
  const stillDue = report.outstanding.length + (s ? 0 : 1)
  const totalMilestones = receivedCount + stillDue
  const nextOutstandingDate = report.outstanding[0]?.dueDate ?? null
  const nextDue =
    !s && report.dueDate
      ? nextOutstandingDate && nextOutstandingDate < report.dueDate
        ? nextOutstandingDate
        : report.dueDate
      : nextOutstandingDate

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
    `${fmtMoney(grantAmount)} awarded ${fmtDate(report.grant.decisionAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb
        items={[
          { label: 'Reports', to: '/reports' },
          { label: `${report.organisationName} · ${report.label}` },
        ]}
      />

      <DetailHeader
        backTo="/reports"
        backLabel="Back to reports"
        name={report.organisationName}
        subline={subline}
        status={{ label: STATUS_LABELS[report.status], colour: STATUS_HEX[report.status] }}
        // The two records this report hangs off. They are links rather than a panel of
        // restated facts: the grant's amount, programme and round are already in the
        // subline and the stat row, and a card repeating them would be the third telling
        // of the same four strings on one screen.
        actions={
          <>
            {/* No icons on these two: the row already carries a File on "View
                submission", and a second document glyph beside it would say the two
                buttons do the same kind of thing. */}
            <LinkButton
              to="/applications/$applicationId"
              params={{ applicationId: report.applicationId }}
            >
              Application
            </LinkButton>
            <LinkButton to="/awards/$awardId" params={{ awardId: report.grant.id }}>
              Grant
            </LinkButton>
            {/* "View submission" is what the application screen calls the same gesture —
                open the thing exactly as it was sent, before anything we made of it. */}
            {s && (
              <Button variant="tinted" icon={File01Icon} onClick={() => setSubmissionOpen(true)}>
                View submission
              </Button>
            )}
            {s && canReview && (
              <Button
                variant={isReviewed ? 'secondary' : 'primary'}
                onClick={handleReview}
                disabled={reviewing}
                title={
                  isReviewed && s.reviewedBy ? `Marked as reviewed by ${s.reviewedBy}` : undefined
                }
              >
                {reviewing ? '…' : isReviewed ? 'Undo review' : 'Mark as reviewed'}
              </Button>
            )}
          </>
        }
      />

      {/* The stat row is the same four tiles whether or not the report has arrived — a
          report still awaited is a thing this screen has plenty to say about, and hiding
          the row would make "nothing reported yet" something you infer from an absence
          rather than something the screen states. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={UserGroupIcon}
          label="Impact reported"
          value={s?.impactQuantity != null ? Number(s.impactQuantity).toLocaleString('en-GB') : '—'}
          // The unit belongs in the supporting line, not the label: a footer reading
          // "young people" while its neighbours read "Grant awarded" is a row of tiles
          // where one is labelled by its data and the rest by their meaning.
          sub={
            s?.impactQuantity != null
              ? [
                  s.impactUnitLabel,
                  s.impactQuantitySource === 'reported'
                    ? 'stated by the charity'
                    : 'read from the narrative',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : s
                ? 'no quantity evidenced'
                : 'not reported yet'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.violet}
          icon={Coins01Icon}
          label="Grant awarded"
          value={fmtMoney(grantAmount)}
          sub={`awarded ${fmtDate(report.grant.decisionAt)}`}
        />
        <MiniKpi
          tint={KPI_TINTS.amber}
          icon={Calendar03Icon}
          label={s ? 'Received' : 'Due'}
          value={s ? fmtDate(s.submittedAt) : fmtDate(report.dueDate)}
          sub={
            s
              ? timeliness(s.submittedAt, report.dueDate)
              : report.status === 'overdue'
                ? 'still outstanding'
                : 'not yet received'
          }
          valueColour={!s && report.status === 'overdue' ? C.danger : undefined}
        />
        <MiniKpi
          tint={KPI_TINTS.green}
          icon={DocumentAttachmentIcon}
          label="Reporting on this grant"
          value={`${receivedCount} of ${totalMilestones}`}
          sub={nextDue ? `next due ${fmtDate(nextDue)}` : 'schedule complete'}
        >
          {totalMilestones > 0 && (
            <ProgressBar
              className="mt-3"
              value={receivedCount / totalMilestones}
              colour={C.success}
              track={C.white}
              height={4}
            />
          )}
        </MiniKpi>
      </div>

      {!s ? (
        // Nothing has arrived, so there is no analysis to draw and nothing to review.
        // The dashed empty state stands on its own rather than inside a panel: a panel
        // would be a titled section whose entire content is "there isn't one".
        <EmptyState>
          <p className="font-display text-body font-medium" style={{ color: C.ink }}>
            {report.status === 'overdue'
              ? `${report.label} was due ${fmtDate(report.dueDate)} and has not arrived.`
              : `${report.label} has not been received yet.`}
          </p>
          <p className="mt-1 font-display text-label" style={{ color: C.sub }}>
            Reports submitted through the grantee form are matched to this grant automatically and
            appear here.
          </p>
        </EmptyState>
      ) : (
        <>
          <ReportAnalysisPanel
            status={s.analysisStatus as ReportAnalysisStatus}
            analysedAt={s.submittedAt}
            action={
              <Button variant="text" size="xs" onClick={() => setSubmissionOpen(true)}>
                Read what they sent →
              </Button>
            }
            analysis={{
              aiSummary: s.aiSummary,
              aiChallenges: s.aiChallenges,
              aiLessons: s.aiLessons,
              applicationAlignment: s.applicationAlignment,
              programmeAlignment: s.programmeAlignment,
              impactQuantity: s.impactQuantity,
              impactQuantitySource: s.impactQuantitySource,
              impactQuantityQuote: s.impactQuantityQuote,
              impactUnitLabel: s.impactUnitLabel,
              flags: s.flags,
            }}
          />

          <Dialog
            open={submissionOpen}
            onClose={() => setSubmissionOpen(false)}
            title="Grant report"
            description={`${report.organisationName} · ${report.label}`}
            size="lg"
          >
            <ReportFields report={s} />
          </Dialog>
        </>
      )}

      <OtherReports siblings={report.siblings} outstanding={report.outstanding} />
    </div>
  )
}

/**
 * The rest of the reporting picture for this grant. A report is rarely read on its
 * own — you want the one before it, and what is still to come from the same grantee.
 */
function OtherReports({
  siblings,
  outstanding,
}: {
  siblings: ReportData['siblings']
  outstanding: ReportData['outstanding']
}) {
  if (siblings.length === 0 && outstanding.length === 0) return null

  return (
    <Panel label="Other reports">
      <PanelTitle>Other reports on this grant</PanelTitle>

      {siblings.length > 0 && (
        <ul className="flex flex-col">
          {siblings.map((r) => (
            <li key={r.key} className="border-t first:border-t-0" style={{ borderColor: C.wash }}>
              <Link
                to="/reports/$reportKey"
                params={{ reportKey: r.key }}
                className="group flex items-center justify-between gap-3 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="truncate font-display text-body font-medium group-hover:underline"
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
                </span>
                <span
                  className="shrink-0 whitespace-nowrap font-display text-label"
                  style={{ color: C.sub }}
                >
                  Received {fmtDate(r.submittedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {outstanding.length > 0 && (
        <>
          <p
            className={`font-display text-label uppercase tracking-wide ${siblings.length > 0 ? 'mt-4' : ''}`}
            style={{ color: C.faint }}
          >
            Still to come
          </p>
          <ul className="mt-1 flex flex-col">
            {outstanding.map((m) => (
              <li key={m.key} className="border-t first:border-t-0" style={{ borderColor: C.wash }}>
                <Link
                  to="/reports/$reportKey"
                  params={{ reportKey: m.key }}
                  className="group flex items-center justify-between gap-3 py-2.5"
                >
                  <span
                    className="truncate font-display text-body group-hover:underline"
                    style={{ color: C.body }}
                  >
                    {m.label}
                  </span>
                  <span
                    className="shrink-0 whitespace-nowrap font-display text-label"
                    style={{
                      color: m.status === 'overdue' ? C.danger : C.sub,
                      fontWeight: m.status === 'overdue' ? 500 : undefined,
                    }}
                  >
                    Due {fmtDate(m.dueDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
