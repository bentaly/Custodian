import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { canSeePayments } from '../../lib/roles'

// The guard for the whole Finance area, on the layout route so every child inherits
// it. Trustees are read-only observers of applications, not of the money — see
// `canSeePayments`. The server fns enforce the same rule independently; this only
// keeps someone from reaching a screen that would 403 at them.
export const Route = createFileRoute('/_authenticated/finance')({
  beforeLoad: ({ context }) => {
    if (!canSeePayments(context.user.role)) throw redirect({ to: '/dashboard' })
  },
  component: () => <Outlet />,
})
