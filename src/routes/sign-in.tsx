import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'
import { Button, Input } from '../components/ui'

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  account_not_linked: `This Google account isn't linked to an existing account. Try signing in with your email and password first.`,
  internal_server_error: 'Something went wrong. Please try again.',
  access_denied: 'Google sign-in was cancelled.',
}

// `signUp` is disabled on the emailOTP plugin, so an unrecognised email fails here
// as INVALID_OTP — indistinguishable from a mistyped code, by design (BetterAuth
// won't confirm whether an account exists). Keep the copy ambiguous to match.
type Mode = 'password' | 'code-request' | 'code-verify' | 'reset-request' | 'reset-verify'

const OTP_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OTP: `That code isn't right. Check the code and try again.`,
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Request a new code.',
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
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState('')
  // 'password' → email + password. 'code-request' → email only, asking for a code.
  // 'code-verify' → a code has been emailed and we're waiting for it.
  // 'reset-request'/'reset-verify' → same two steps, but the code sets a new password.
  const [mode, setMode] = useState<Mode>('password')
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

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Could not send a code. Please try again.')
      return
    }
    // Succeeds even for an unknown email (no mail is sent) so the response can't be
    // used to enumerate accounts. Advance regardless — the copy stays conditional.
    setOtp('')
    setMode('code-verify')
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.signIn.emailOtp({ email, otp })
    setLoading(false)
    if (error) {
      setError(
        (error.code && OTP_ERROR_MESSAGES[error.code]) ??
          error.message ??
          'Sign in failed'
      )
    } else {
      navigate({ to: '/dashboard' })
    }
  }

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.emailOtp.requestPasswordReset({ email })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Could not send a code. Please try again.')
      return
    }
    setOtp('')
    setNewPassword('')
    setMode('reset-verify')
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.emailOtp.resetPassword({
      email,
      otp,
      password: newPassword,
    })
    if (error) {
      setLoading(false)
      setError(
        (error.code && OTP_ERROR_MESSAGES[error.code]) ?? error.message ?? 'Could not reset password'
      )
      return
    }
    // The password we just set is known-good, so sign in with it rather than
    // bouncing the user back to a form to retype it.
    const { error: signInError } = await authClient.signIn.email({ email, password: newPassword })
    setLoading(false)
    if (signInError) {
      switchMode('password')
      setNotice('Password updated. Please sign in.')
      return
    }
    navigate({ to: '/dashboard' })
  }

  function switchMode(next: Mode) {
    setError('')
    setNotice('')
    setPassword('')
    setOtp('')
    setNewPassword('')
    setMode(next)
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
        {notice && <p className="text-sm text-green-600">{notice}</p>}

        {mode === 'password' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-xs text-gray-500">
              <button
                type="button"
                onClick={() => switchMode('code-request')}
                className="hover:text-gray-900"
              >
                Email me a code instead
              </button>
              <button
                type="button"
                onClick={() => switchMode('reset-request')}
                className="hover:text-gray-900"
              >
                Forgot your password?
              </button>
            </div>
          </form>
        )}

        {mode === 'code-request' && (
          <form onSubmit={handleRequestCode} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Sending…' : 'Email me a code'}
            </Button>
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="w-full text-xs text-gray-500 hover:text-gray-900"
            >
              Use a password instead
            </button>
          </form>
        )}

        {mode === 'code-verify' && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <p className="text-sm text-gray-500">
              If an account exists for <span className="text-gray-900">{email}</span>, we've sent
              it a 6-digit code. It expires in 5 minutes.
            </p>
            <Input
              // A one-time code, not a password: `otp` lets iOS/Android offer it from
              // the notification, and numeric inputMode raises the right keypad.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              aria-label="6-digit sign-in code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="text-center text-lg tracking-[0.4em]"
              autoFocus
              required
            />
            <Button type="submit" disabled={loading || otp.length !== 6} className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <button
              type="button"
              onClick={() => switchMode('code-request')}
              className="w-full text-xs text-gray-500 hover:text-gray-900"
            >
              Use a different email, or send a new code
            </button>
          </form>
        )}

        {mode === 'reset-request' && (
          <form onSubmit={handleRequestReset} className="space-y-3">
            <p className="text-sm text-gray-500">
              We'll email you a code to set a new password. This also works if you've only ever
              signed in with Google and want to add a password.
            </p>
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Sending…' : 'Email me a reset code'}
            </Button>
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="w-full text-xs text-gray-500 hover:text-gray-900"
            >
              Back to sign in
            </button>
          </form>
        )}

        {mode === 'reset-verify' && (
          <form onSubmit={handleResetPassword} className="space-y-3">
            <p className="text-sm text-gray-500">
              If an account exists for <span className="text-gray-900">{email}</span>, we've sent it
              a 6-digit code. It expires in 5 minutes.
            </p>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              aria-label="6-digit reset code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="text-center text-lg tracking-[0.4em]"
              autoFocus
              required
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              aria-label="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <Button
              type="submit"
              disabled={loading || otp.length !== 6 || !newPassword}
              className="w-full"
            >
              {loading ? 'Updating…' : 'Set new password'}
            </Button>
            <button
              type="button"
              onClick={() => switchMode('reset-request')}
              className="w-full text-xs text-gray-500 hover:text-gray-900"
            >
              Use a different email, or send a new code
            </button>
          </form>
        )}

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
