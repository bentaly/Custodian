import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getApplication, rerunDueDiligence, rerunCustodianScore, updateApplicationStatus } from '../../server/fns/applications'
import { DueDiligencePanel } from '../../components/dueDiligence'
import { CustodianScorePanel } from '../../components/custodianScore'
import { ApplicationDrawer } from '../../components/ApplicationDrawer'
import { CommentsSection } from '../../components/CommentsSection'
import { VotingSection } from '../../components/VotingSection'
import type { DueDiligenceCheckRecord, DueDiligenceStatus } from '../../lib/dueDiligence'
import type { CustodianScoreDetail, CustodianScoreStatus } from '../../lib/custodianScore'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  loader: ({ params }) => getApplication({ data: { id: params.applicationId } }),
  component: ApplicationDetail,
})

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function RoundProgrammeBudgetBar({
  budget,
  committed,
}: {
  budget: number
  committed: number
}) {
  const pct = Math.min(100, (committed / budget) * 100)
  const remaining = budget - committed
  const isOver = remaining < 0
  const barColor = pct >= 100 ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 4 }}>
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-500">
        {fmtCompact(committed)} / {fmtCompact(budget)}
      </span>
      <span className={`text-xs tabular-nums ${isOver ? 'text-red-500' : 'text-gray-400'}`}>
        {isOver ? `${fmtCompact(-remaining)} over` : `${fmtCompact(remaining)} left`}
      </span>
    </div>
  )
}

function ApplicationDetail() {
  const application = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [rerunning, setRerunning] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [shortlisting, setShortlisting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [shortlistError, setShortlistError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isShortlisted = application.status === 'shortlisted'
  const isDeclined = application.status === 'declined'
  const isAwarded = application.status === 'awarded'

  const rp = application.roundProgramme
  const budget = rp.budget ? parseFloat(rp.budget) : null
  const committed = application.roundProgrammeCommitted
  // Budget is full when committed (excluding this app) would already meet or exceed budget.
  // We check against committed as returned by the server (which already excludes nothing — it
  // includes this app if already shortlisted, excludes it if not). So the "would exceed" check
  // is: committed + amountRequested > budget when NOT yet shortlisted.
  const amountRequested = parseFloat(application.amountRequested)
  const isBudgetFull =
    !isShortlisted &&
    budget !== null &&
    committed + amountRequested > budget

  async function handleShortlist() {
    setShortlistError(null)
    setShortlisting(true)
    try {
      await updateApplicationStatus({
        data: { id: application.id, status: isShortlisted ? 'for_review' : 'shortlisted' },
      })
      await router.invalidate()
    } catch (err) {
      setShortlistError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setShortlisting(false)
    }
  }

  async function handleDecline() {
    setShortlistError(null)
    setDeclining(true)
    try {
      await updateApplicationStatus({
        data: { id: application.id, status: isDeclined ? 'for_review' : 'declined' },
      })
      await router.invalidate()
    } catch (err) {
      setShortlistError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setDeclining(false)
    }
  }

  async function handleRerun() {
    setRerunning(true)
    try {
      await rerunDueDiligence({ data: { id: application.id } })
      await router.invalidate()
    } finally {
      setRerunning(false)
    }
  }

  async function handleRescore() {
    setRescoring(true)
    try {
      await rerunCustodianScore({ data: { id: application.id } })
      await router.invalidate()
    } finally {
      setRescoring(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link to="/applications" search={{ roundId: undefined }} className="hover:text-gray-600">
          Applications
        </Link>
        <span>›</span>
        <span className="text-gray-600">{application.organisationName}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">{application.organisationName}</h1>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {isAwarded && (
              <span className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                ✓ Awarded
              </span>
            )}
            {!isDeclined && !isAwarded && (
              <button
                onClick={handleShortlist}
                disabled={shortlisting || isBudgetFull}
                title={isBudgetFull ? 'Budget committed — no funds remaining in this programme' : undefined}
                className={`rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  isShortlisted
                    ? 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    : isBudgetFull
                      ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                      : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {shortlisting
                  ? '…'
                  : isShortlisted
                    ? '✓ Shortlisted'
                    : isBudgetFull
                      ? 'Budget full'
                      : 'Add to shortlist'}
              </button>
            )}
            <button
              onClick={handleDecline}
              disabled={declining}
              className={`rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                isDeclined
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {declining ? '…' : isDeclined ? '✓ Declined · Reinstate' : 'Decline'}
            </button>
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
              View application
            </button>
          </div>
          {shortlistError && (
            <p className="text-xs text-red-500">{shortlistError}</p>
          )}
          {budget !== null && (
            <div className="w-72">
              <p className="mb-1 text-xs text-gray-400">{rp.programme.name} budget</p>
              <RoundProgrammeBudgetBar budget={budget} committed={committed} />
            </div>
          )}
        </div>
      </div>

      <CustodianScorePanel
        status={(application.custodianScoreStatus ?? 'pending') as CustodianScoreStatus}
        score={application.custodianScore}
        detail={application.custodianScoreDetail as CustodianScoreDetail | null}
        scoredAt={application.custodianScoredAt}
        action={
          <button
            onClick={handleRescore}
            disabled={rescoring}
            className="rounded border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {rescoring ? 'Scoring…' : 'Re-score'}
          </button>
        }
      />

      <DueDiligencePanel
        status={(application.dueDiligenceStatus ?? 'pending') as DueDiligenceStatus}
        checks={application.dueDiligenceChecks as DueDiligenceCheckRecord[] | null}
        checkedAt={application.dueDiligenceCheckedAt}
        action={
          <button
            onClick={handleRerun}
            disabled={rerunning}
            className="rounded border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {rerunning ? 'Re-running…' : 'Re-run'}
          </button>
        }
      />

      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-6">
        <VotingSection
          applicationId={application.id}
          userId={user.id}
          userRole={user.role}
        />
        <CommentsSection
          applicationId={application.id}
          userRole={user.role}
        />
      </div>

      <ApplicationDrawer
        application={application}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
