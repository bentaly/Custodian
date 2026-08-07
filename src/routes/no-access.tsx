import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getMe } from '../server/fns/auth'
import { authClient } from '../lib/auth-client'
import { AuthShell } from '../components/AuthShell'
import { Button } from '../components/ui'

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
    <AuthShell>
      <h1 className="font-display text-[32px] font-semibold text-ink">No organisation yet</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
        You're signed in, but your account isn't linked to an organisation yet. Custodian is
        invite-only — ask your administrator to send an invitation to this email address.
      </p>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
        If you've already been invited, open the link in that email, or sign in with the address the
        invitation was sent to.
      </p>
      <Button variant="secondary" onClick={handleSignOut} className="mt-7 w-full">
        Sign out
      </Button>
    </AuthShell>
  )
}
