import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  account_not_linked: `This Google account isn't linked to an existing account. Try signing in with your email and password first.`,
  internal_server_error: 'Something went wrong. Please try again.',
  access_denied: 'Google sign-in was cancelled.',
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search['error'] === 'string' ? search['error'] : undefined,
  }),
  component: SignInPage,
})

function SignInPage() {
  const navigate = useNavigate()
  const { error: oauthError } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(
    oauthError
      ? (OAUTH_ERROR_MESSAGES[oauthError] ?? `Sign in failed (${oauthError})`)
      : ''
  )
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.signIn.email({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Sign in failed')
    } else {
      navigate({ to: '/dashboard' })
    }
  }

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in',
    })
    if (error) {
      setGoogleLoading(false)
      setError(error.message ?? 'Google sign-in failed')
    }
    // on success the browser redirects away, so no need to reset loading
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow">
        <h1 className="text-xl font-semibold text-gray-900">Sign in to Custodian</h1>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
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

      </div>
    </div>
  )
}
