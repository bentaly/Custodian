import { useEffect } from 'react'
import type { CustodianScoreDetail, CustodianScoreStatus } from '../lib/custodianScore'
import { CustodianScorePanel } from './custodianScore'
import { CommentsSection } from './CommentsSection'
import { VotingSection } from './VotingSection'
import { ApplicationFields, type ApplicationFieldsData } from './ApplicationFields'
import { Button } from './ui'

type BriefingApplication = ApplicationFieldsData & {
  id: string
  organisationName: string
  custodianScore: number | null | undefined
  custodianScoreStatus: string | null | undefined
  custodianScoreDetail: unknown
  custodianScoredAt: string | Date | null | undefined
}

export function BriefingDrawer({
  application,
  open,
  onClose,
  user,
}: {
  application: BriefingApplication | null
  open: boolean
  onClose: () => void
  user: { id: string; role: string }
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Application briefing"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Briefing</h2>
            <p className="mt-0.5 text-sm text-gray-500">{application?.organisationName ?? ''}</p>
          </div>
          <Button variant="icon" onClick={onClose}>
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Button>
        </div>

        {application && (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* AI score */}
            <CustodianScorePanel
              status={(application.custodianScoreStatus ?? 'pending') as CustodianScoreStatus}
              score={application.custodianScore}
              detail={application.custodianScoreDetail as CustodianScoreDetail | null}
              scoredAt={application.custodianScoredAt}
            />

            {/* Application fields + form responses */}
            <ApplicationFields application={application} />

            {/* Votes */}
            <section>
              <VotingSection
                applicationId={application.id}
                userId={user.id}
                userRole={user.role}
              />
            </section>

            {/* Comments */}
            <section>
              <CommentsSection
                applicationId={application.id}
                userId={user.id}
                userRole={user.role}
              />
            </section>
          </div>
        )}
      </div>
    </>
  )
}
