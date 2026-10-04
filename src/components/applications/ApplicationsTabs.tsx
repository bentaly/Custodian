import { useNavigate } from '@tanstack/react-router'
import { Tabs } from '../ui'

// Applications is two routes wearing one pair of tabs, for a foundation that takes
// expressions of interest: the applications themselves, and the EOIs that come before
// them. Same shape as Shortlist's "To vote / Set up awards" and Finance's two tabs: these
// are NAVIGATION between two screens, not a filter over one list.
//
// EOIs are here rather than in the rail on purpose. They are the front half of the same
// story the applications reviewer is already reading, and the rail is full.
//
// Rendered only when the foundation uses EOIs at all (`getEoiNav`): a programme switched
// on to take them, or one already on file. Everybody else sees Applications exactly as
// it was.

export type ApplicationsTab = 'applications' | 'eois'

export function ApplicationsTabs({
  tab,
  eoisToReview,
}: {
  tab: ApplicationsTab
  /** How many EOIs are waiting to be read. The only count: applications have their own. */
  eoisToReview: number
}) {
  const navigate = useNavigate()
  return (
    <Tabs<ApplicationsTab>
      ariaLabel="Applications view"
      value={tab}
      items={[
        { id: 'applications', label: 'Applications' },
        { id: 'eois', label: 'Expressions of interest', count: eoisToReview },
      ]}
      onChange={(next) => {
        if (next === tab) return
        if (next === 'eois') navigate({ to: '/applications/eois' })
        else navigate({ to: '/applications', search: { roundId: undefined } })
      }}
    />
  )
}
