import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'
import { getInvitationByToken } from '../server/fns/invitations'
import { completeRegistration } from '../server/fns/registrations'
import { Button, Input } from '../components/ui'

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

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    // OAuth never returns here, so it can't call completeRegistration with the token.
    // It doesn't need to: `getMe` claims a pending invite by email for any tenant-less
    // user whose address is verified, and Google's always is. The invite must therefore
    // be addressed to the same email as the Google account — hence the warning below.
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

  if (invite && !invitation) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow text-center">
          <p className="text-sm text-gray-500">This invitation is invalid or has expired.</p>
          <Link to="/sign-in" className="mt-4 block text-sm text-gray-900 underline">
            Sign in instead
          </Link>
        </div>
      </div>
    )
  }

  // Invite-only onboarding: with no invitation there is no usable sign-up form.
  if (!isInvite) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow text-center">
          <h1 className="text-lg font-semibold text-gray-900">Invitation required</h1>
          <p className="text-sm text-gray-500">
            Custodian is invite-only. Ask your administrator to send you an invitation to join your
            organisation.
          </p>
          <Link to="/sign-in" className="block text-sm text-gray-900 underline">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-5 rounded-lg bg-white p-8 shadow">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Create an account</h1>
          <p className="mt-1 text-sm text-gray-500">
            You've been invited to join <span className="font-medium text-gray-700">{invitation.clientName}</span>
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="Email"
            value={email}
            readOnly
            className="bg-gray-50 text-gray-500 cursor-not-allowed"
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs text-gray-400">
            <span className="bg-white px-2">or</span>
          </div>
        </div>

        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {googleLoading ? 'Redirecting to Google…' : 'Continue with Google'}
        </button>
        <p className="text-center text-xs text-gray-400">
          Use the Google account for {invitation.email}
        </p>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/sign-in" className="text-gray-900 underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
