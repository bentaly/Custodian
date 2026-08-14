import { Dialog } from './ui'
import { ApplicationFields, type ApplicationFieldsData } from './ApplicationFields'

// The dialog needs the organisation name for its header on top of the fields the
// shared renderer shows.
type SubmissionApplication = ApplicationFieldsData & {
  organisationName: string
}

export function ApplicationSubmissionDialog({
  application,
  open,
  onClose,
}: {
  application: SubmissionApplication
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
      <ApplicationFields application={application} />
    </Dialog>
  )
}
