import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getApplication, rerunDueDiligence, rerunCustodianScore } from '../../server/fns/applications'
import { DueDiligencePanel } from '../../components/dueDiligence'
import { CustodianScorePanel } from '../../components/custodianScore'
import { ApplicationDrawer } from '../../components/ApplicationDrawer'
import type { DueDiligenceCheckRecord, DueDiligenceStatus } from '../../lib/dueDiligence'
import type { CustodianScoreDetail, CustodianScoreStatus } from '../../lib/custodianScore'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  loader: ({ params }) => getApplication({ data: { id: params.applicationId } }),
  component: ApplicationDetail,
})

function ApplicationDetail() {
  const application = Route.useLoaderData()
  const router = useRouter()
  const [rerunning, setRerunning] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">{application.organisationName}</h1>
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

      <ApplicationDrawer
        application={application}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
