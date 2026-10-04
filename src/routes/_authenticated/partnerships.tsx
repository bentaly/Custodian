import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/partnerships')({
  // Behind the `sourcing` flag (`lib/features.ts`): on production the screen does not
  // exist yet. The server functions refuse on their own; this only spares the reader a
  // page of errors. Read off the cached user, so it costs no request.
  beforeLoad: ({ context }) => {
    if (!context.user.features.sourcing) throw notFound()
  },
  component: () => <Outlet />,
})
