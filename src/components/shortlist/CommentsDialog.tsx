import { Button, Dialog } from '../ui'
import { CommentsSection } from '../CommentsSection'

// The board's discussion on one application, over the vote card.
//
// The comps put a bare "Add a comment…" box in each vote card, which is the one thing a
// discussion box must never be: somewhere to write into without being shown what has
// already been said. A trustee typing "agreed with Helen's concern" cannot see Helen's
// concern, and two people write the same note. So the card carries a count instead, and
// the count opens the thread — read first, then reply, without leaving the decision.
//
// It is the SAME component as the application screen's (`CommentsSection`), not a second
// drawing of the same thread: this used to be its own implementation, which is how the
// two came to look different and how a change to one (the Activity tab) would have had
// to be made twice. This file is only the frame around it. The card's split button opens
// it on either tab.

export function CommentsDialog({
  applicationId,
  organisationName,
  userId,
  userRole,
  onClose,
  onChanged,
  initialTab,
}: {
  applicationId: string
  organisationName: string
  /** The reader, so their own remarks can carry Edit / Delete. */
  userId: string
  userRole: string
  onClose: () => void
  /** Fired after a comment lands or goes, so the card's count can catch up. */
  onChanged: () => void
  initialTab?: 'comments' | 'activity'
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={organisationName}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <CommentsSection
        applicationId={applicationId}
        userId={userId}
        userRole={userRole}
        onChanged={onChanged}
        initialTab={initialTab}
      />
    </Dialog>
  )
}
