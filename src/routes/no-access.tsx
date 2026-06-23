import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getMe } from '../server/fns/auth'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/no-access')({
  beforeLoad: async () => {
    const user = await getMe()
    // Not signed in → nothing to deny; send to sign-in.
    if (!user) throw redirect({ to: '/sign-in' })
    // Already has a tenant (or is a superadmin) → they do have access; send them in.
    if (user.clientId || user.role === 'superadmin') throw redirect({ to: '/dashboard' })
  },
  component: NoAccessPage,
})

function NoAccessPage() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await authClient.signOut()
    navigate({ to: '/sign-in' })
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 text-center shadow">
        <h1 className="text-lg font-semibold text-gray-900">No access yet</h1>
        <p className="text-sm text-gray-500">
          Your account isn't linked to an organisation. Custodian is invite-only — ask your
          administrator to send you an invitation.
        </p>
        <button
          onClick={handleSignOut}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
