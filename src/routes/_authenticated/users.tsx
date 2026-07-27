import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The old Organisation screen, which bolted together the team, the giving strategy,
 * the voting toggle and the API keys. Those are now separate Settings pages. Kept as
 * a redirect because /users is the URL people have bookmarked.
 */
export const Route = createFileRoute('/_authenticated/users')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/team' })
  },
})
