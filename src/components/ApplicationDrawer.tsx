import { Drawer } from './Drawer'
import { ApplicationFields, type ApplicationFieldsData } from './ApplicationFields'

// The drawer needs the organisation name for its header on top of the fields the
// shared renderer shows.
type DrawerApplication = ApplicationFieldsData & {
  organisationName: string
}

export function ApplicationDrawer({
  application,
  open,
  onClose,
}: {
  application: DrawerApplication
  open: boolean
  onClose: () => void
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Application form"
      subtitle={application.organisationName}
      ariaLabel="Application form responses"
    >
      <ApplicationFields application={application} />
    </Drawer>
  )
}
