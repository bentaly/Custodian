import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'
import { getInvitationByToken } from '../server/fns/invitations'
import { completeRegistration } from '../server/fns/registrations'
import { AuthShell } from '../components/AuthShell'
import { AuthButton, AuthInput, Divider, GoogleButton, Notice } from '../components/ui/auth'

export const Route = createFileRoute('/sign-up')({
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search['invite'] === 'string' ? search['invite'] : undefined,
  }),
  loaderDeps: ({ search: { invite } }) => ({ invite }),
  loader: async ({ deps: { invite } }) => {
    if (!invite) return { invitation: null }
    const invitation = await getInvitationByToken({ data: { token: invite } })
    return { invitation }
  },
  component: SignUpPage,
})

function SignUpPage() {
  const navigate = useNavigate()
  const { invite } = Route.useSearch()
  const { invitation } = Route.useLoaderData()

  const isInvite = !!invite && !!invitation

  const [name, setName] = useState('')
  const [email, setEmail] = useState(invitation?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: signUpError } = await authClient.signUp.email({ name, email, password })
    if (signUpError) {
      setError(signUpError.message ?? 'Sign up failed')
      setLoading(false)
      return
    }

    try {
      await completeRegistration({ data: { inviteToken: invite } })
    } catch (err) {
      await authClient.signOut()
      setError(err instanceof Error ? err.message : 'Registration failed')
      setLoading(false)
      return
    }

    navigate({ to: '/dashboard' })
  }

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    // OAuth never returns here, so it can't call completeRegistration with the token.
    // It doesn't need to: `getMe` claims a pending invite by email for any tenant-less
    // user whose address is verified, and Google's always is. The invite must therefore
    // be addressed to the same email as the Google account — hence the note below.
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in',
    })
    if (error) {
      setGoogleLoading(false)
      setError(error.message ?? 'Google sign-up failed')
    }
  }

  if (invite && !invitation) {
    return (
      <AuthShell>
        <h1 className="font-display text-[32px] font-semibold text-ink">Invitation expired</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          This invitation is no longer valid — invitations last 7 days. Ask your administrator to
          send a new one.
        </p>
        <Link
          to="/sign-in"
          className="mt-7 block w-full rounded-xl border border-hairline bg-white px-4 py-3 text-center text-[15px] font-medium text-ink-soft hover:bg-canvas"
        >
          Back to sign in
        </Link>
      </AuthShell>
    )
  }

  if (!isInvite) {
    return (
      <AuthShell>
        <h1 className="font-display text-[32px] font-semibold text-ink">You'll need an invitation</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          Custodian is invite-only. Ask your administrator to invite you to your organisation, and
          you'll get an email with a link to set up your account.
        </p>
        <Link
          to="/sign-in"
          className="mt-7 block w-full rounded-xl border border-hairline bg-white px-4 py-3 text-center text-[15px] font-medium text-ink-soft hover:bg-canvas"
        >
          Back to sign in
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="font-display text-[32px] font-semibold text-ink">Create your account</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
        You've been invited to join{' '}
        <span className="font-medium text-ink">{invitation.clientName}</span>.
      </p>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="mt-7 space-y-5">
        <div>
          <GoogleButton onClick={handleGoogle} loading={googleLoading} label="Continue with Google" />
          <p className="mt-2 text-center text-[13px] text-ink-muted">
            Use the Google account for {invitation.email}
          </p>
        </div>

        <Divider>or</Divider>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthInput
            label="Full name"
            type="text"
            autoComplete="name"
            placeholder="Alex Fielding"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <AuthInput
            label="Email"
            type="email"
            value={email}
            readOnly
            className="cursor-not-allowed text-ink-muted"
            required
          />
          <AuthInput
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <AuthButton loading={loading} loadingLabel="Creating account…">
            Create account
          </AuthButton>
        </form>

        <p className="text-center text-[13px] text-ink-muted">
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-moss-700 hover:text-moss-600">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
