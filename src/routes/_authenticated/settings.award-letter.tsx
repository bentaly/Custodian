// The award letter got a sibling and the screen became "Letters". Kept as a redirect
// rather than deleted: this URL is in the app's own history, in bookmarks, and in
// anything anyone has written down — the same treatment `/users` got when it split.
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings/award-letter')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/letters', search: { tab: 'award' } })
  },
})
