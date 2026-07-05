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
