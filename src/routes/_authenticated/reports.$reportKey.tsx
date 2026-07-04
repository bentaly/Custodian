import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getReport, markReportReviewed, type ReportRowStatus } from '../../server/fns/reports'
import { Drawer } from '../../components/Drawer'
import { ReportFields } from '../../components/ReportFields'
import { ReportAnalysisPanel, type ReportAnalysisStatus } from '../../components/reportAnalysis'

export const Route = createFileRoute('/_authenticated/reports/$reportKey')({
  loader: ({ params }) => getReport({ data: { key: params.reportKey } }),
  component: ReportDetail,
})

const STATUS_LABELS: Record<ReportRowStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  received: 'Received',
  reviewed: 'Reviewed',
}

const STATUS_COLORS: Record<ReportRowStatus, string> = {
  overdue: 'border-red-200 bg-red-50 text-red-700',
  due_soon: 'border-amber-200 bg-amber-50 text-amber-700',
  upcoming: 'border-gray-200 bg-gray-50 text-gray-600',
  received: 'border-blue-200 bg-blue-50 text-blue-700',
  reviewed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

function fmtDate(date: Date | string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link to="/reports" className="hover:text-gray-600">
          Reports
        </Link>
        <span>›</span>
        <span className="text-gray-600">
          {report.organisationName} · {report.label}
        </span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{report.organisationName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span>
              <span className="text-gray-400">Report </span>
              <span className="font-medium text-gray-700">{report.label}</span>
            </span>
            {report.dueDate && (
              <span>
                <span className="text-gray-400">Due </span>
                <span className="font-medium text-gray-700">{fmtDate(report.dueDate)}</span>
              </span>
            )}
            {report.programmeName && (
              <span>
                <span className="text-gray-400">Programme </span>
                <span className="font-medium text-gray-700">{report.programmeName}</span>
              </span>
            )}
            <span>
              <span className="text-gray-400">Grant </span>
              <span className="font-semibold text-gray-900">
                £{Math.round(Number(report.grant.amountAwarded)).toLocaleString('en-GB')}
              </span>
              <span className="text-gray-400"> awarded {fmtDate(report.grant.decisionAt)}</span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded border px-3 py-1.5 text-sm font-medium ${STATUS_COLORS[report.status]}`}
            title={isReviewed && s?.reviewedBy ? `Reviewed by ${s.reviewedBy}` : undefined}
          >
            {report.status === 'received'
              ? '✓ Received'
              : report.status === 'reviewed'
                ? '✓ Reviewed'
                : STATUS_LABELS[report.status]}
          </span>
          {s && canReview && (
            <button
              onClick={handleReview}
              disabled={reviewing}
              className={`rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                isReviewed
                  ? 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {reviewing ? '…' : isReviewed ? 'Undo review' : 'Mark as reviewed'}
            </button>
          )}
          {s && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                  clipRule="evenodd"
                />
              </svg>
              View report
            </button>
          )}
          {report.applicationId && (
            <Link
              to="/applications/$applicationId"
              params={{ applicationId: report.applicationId }}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              View application
            </Link>
          )}
        </div>
      </div>

      {!s ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-gray-500">
            {report.status === 'overdue'
              ? 'This report is overdue — no submission has been received.'
              : 'No submission received yet.'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Submitted reports are matched to this grant automatically and will appear here.
          </p>
        </div>
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
    </div>
  )
}
