import { Dialog } from './ui'
import { ApplicationFields, type ApplicationFieldsData } from './ApplicationFields'

// The dialog needs the organisation name for its header on top of the fields the
// shared renderer shows.
type SubmissionApplication = ApplicationFieldsData & {
  organisationName: string
}

export function ApplicationSubmissionDialog({
  application,
  programmeName,
  open,
  onClose,
}: {
  application: SubmissionApplication
  /** The programme applied to — a field of the submission that lives on the round
   *  programme rather than on the application, so the renderer cannot reach it. */
  programmeName?: string | null
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Application form"
      description={application.organisationName}
      size="lg"
    >
      <ApplicationFields application={application} programmeName={programmeName} />
    </Dialog>
  )
}
