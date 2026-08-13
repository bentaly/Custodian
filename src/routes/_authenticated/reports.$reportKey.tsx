import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { useState } from 'react'
import { getReport, markReportReviewed, type ReportRowStatus } from '../../server/fns/reports'
import { Drawer } from '../../components/Drawer'
import { ReportFields } from '../../components/ReportFields'
import { ReportAnalysisPanel, type ReportAnalysisStatus } from '../../components/reportAnalysis'
import { Breadcrumb, Button, Card, EmptyState } from '../../components/ui'
import { fmtDate } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/reports/$reportKey')({
  loader: ({ params }) => orNotFound(getReport({ data: { key: params.reportKey } })),
  component: ReportDetail,
})

const STATUS_LABELS: Record<ReportRowStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  received: 'Received',
  reviewed: 'Reviewed',
}

const STATUS_COLOURS: Record<ReportRowStatus, string> = {
  overdue: 'border-danger/20 bg-danger/10 text-danger',
  due_soon: 'border-warning/20 bg-warning/10 text-warning',
  upcoming: 'border-grey-200 bg-grey-50 text-grey-600',
  received: 'border-info/20 bg-info/10 text-info',
  reviewed: 'border-success/20 bg-success/10 text-success',
}

function ReportDetail() {
  const report = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const s = report.submission
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const canReview = user.role === 'admin' || user.role === 'superadmin'
  const isReviewed = Boolean(s?.reviewedAt)

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

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: 'Reports', to: '/reports' },
          { label: `${report.organisationName} · ${report.label}` },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold text-grey-900">{report.organisationName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-grey-500">
            <span>
              <span className="text-grey-400">Report </span>
              <span className="font-medium text-grey-700">{report.label}</span>
            </span>
            {report.dueDate && (
              <span>
                <span className="text-grey-400">Due </span>
                <span className="font-medium text-grey-700">{fmtDate(report.dueDate)}</span>
              </span>
            )}
            {report.programmeName && (
              <span>
                <span className="text-grey-400">Programme </span>
                <span className="font-medium text-grey-700">{report.programmeName}</span>
              </span>
            )}
            <span>
              <span className="text-grey-400">Grant </span>
              <span className="font-semibold text-grey-900">
                £{Math.round(Number(report.grant.amountAwarded)).toLocaleString('en-GB')}
              </span>
              <span className="text-grey-400"> awarded {fmtDate(report.grant.decisionAt)}</span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-chip border px-3 py-1.5 text-body font-medium ${STATUS_COLOURS[report.status]}`}
            title={isReviewed && s?.reviewedBy ? `Reviewed by ${s.reviewedBy}` : undefined}
          >
            {report.status === 'received'
              ? '✓ Received'
              : report.status === 'reviewed'
                ? '✓ Reviewed'
                : STATUS_LABELS[report.status]}
          </span>
          {s && canReview && (
            <Button
              variant={isReviewed ? 'secondary' : 'primary'}
              size="sm"
              onClick={handleReview}
              disabled={reviewing}
            >
              {reviewing ? '…' : isReviewed ? 'Undo review' : 'Mark as reviewed'}
            </Button>
          )}
          {s && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1.5"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                  clipRule="evenodd"
                />
              </svg>
              View report
            </Button>
          )}
          <Link
            to="/applications/$applicationId"
            params={{ applicationId: report.applicationId }}
            className="rounded-chip border border-grey-200 px-3 py-1.5 text-body font-medium text-grey-600 hover:bg-grey-50"
          >
            View application
          </Link>
        </div>
      </div>

      {!s ? (
        <EmptyState>
          <p className="text-body text-grey-500">
            {report.status === 'overdue'
              ? 'This report is overdue — no submission has been received.'
              : 'No submission received yet.'}
          </p>
          <p className="mt-1 text-label text-grey-400">
            Submitted reports are matched to this grant automatically and will appear here.
          </p>
        </EmptyState>
      ) : (
        <>
          <ReportAnalysisPanel
            status={s.analysisStatus as ReportAnalysisStatus}
            analysedAt={s.submittedAt}
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

          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title="Grant report"
            subtitle={report.organisationName}
            ariaLabel="Grant report submission"
          >
            <ReportFields report={s} />
          </Drawer>
        </>
      )}

      <AwardReports siblings={report.siblings} outstanding={report.outstanding} />
    </div>
  )
}

/**
 * The rest of the reporting picture for this award. A report is rarely read on its
 * own — you want the one before it, and what is still to come from the same grantee.
 */
function AwardReports({
  siblings,
  outstanding,
}: {
  siblings: Array<{ key: string; label: string; submittedAt: string; status: string }>
  outstanding: Array<{ key: string; label: string; dueDate: string; status: string }>
}) {
  if (siblings.length === 0 && outstanding.length === 0) return null

  return (
    <Card className="px-5 py-4">
      <h2 className="text-body font-semibold text-grey-900">Other reports on this award</h2>

      {siblings.length > 0 && (
        <ul className="mt-3 divide-y divide-grey-100">
          {siblings.map((r) => (
            <li key={r.key} className="py-2">
              <Link
                to="/reports/$reportKey"
                params={{ reportKey: r.key }}
                className="flex items-center justify-between gap-3 text-body hover:underline"
              >
                <span className="truncate font-medium text-grey-900">{r.label}</span>
                <span className="shrink-0 text-label text-grey-500">
                  Received {fmtDate(r.submittedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {outstanding.length > 0 && (
        <>
          <p className="mt-4 text-label uppercase tracking-wide text-grey-400">Still to come</p>
          <ul className="mt-1 divide-y divide-grey-100">
            {outstanding.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-3 py-2 text-body">
                <span className="truncate text-grey-600">{m.label}</span>
                <span
                  className={`shrink-0 text-label ${
                    m.status === 'overdue' ? 'font-medium text-danger' : 'text-grey-500'
                  }`}
                >
                  Due {fmtDate(m.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
