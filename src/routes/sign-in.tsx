import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'
import { AuthShell } from '../components/AuthShell'
import { CodeInput } from '../components/ui/CodeInput'
import { AuthButton, AuthInput, Divider, GoogleButton, Notice } from '../components/ui/auth'

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  account_not_linked: `This Google account isn't linked to an existing account. Try signing in with your email and password first.`,
  internal_server_error: 'Something went wrong. Please try again.',
  access_denied: 'Google sign-in was cancelled.',
}

// `signUp` is disabled on the emailOTP plugin, so an unrecognised email fails here as
// INVALID_OTP — indistinguishable from a mistyped code, by design (BetterAuth won't
// confirm whether an account exists). Keep the copy ambiguous to match.
const OTP_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OTP: `That code isn't right. Check it and try again.`,
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Send a new code.',
}

type Mode = 'password' | 'code-request' | 'code-verify' | 'reset-request' | 'reset-verify'

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
  const [mode, setMode] = useState<Mode>('password')
  const [error, setError] = useState(
    oauthError ? (OAUTH_ERROR_MESSAGES[oauthError] ?? `Sign in failed (${oauthError})`) : '',
  )
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  function switchMode(next: Mode) {
    setError('')
    setNotice('')
    setPassword('')
    setOtp('')
    setNewPassword('')
    setMode(next)
  }

  function otpMessage(err: { code?: string; message?: string }, fallback: string) {
    return (err.code && OTP_ERROR_MESSAGES[err.code]) ?? err.message ?? fallback
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.signIn.email({ email, password })
    setLoading(false)
    if (error) setError(error.message ?? 'Sign in failed')
    else navigate({ to: '/dashboard' })
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
    // On success the browser leaves for Google, so there's no loading state to reset.
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
    // Succeeds even for an unknown email (nothing is sent) so the response can't be used
    // to enumerate accounts. Advance regardless — the copy stays conditional.
    setOtp('')
    setMode('code-verify')
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.signIn.emailOtp({ email, otp })
    setLoading(false)
    if (error) setError(otpMessage(error, 'Sign in failed'))
    else navigate({ to: '/dashboard' })
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
    const { error } = await authClient.emailOtp.resetPassword({ email, otp, password: newPassword })
    if (error) {
      setLoading(false)
      setError(otpMessage(error, 'Could not set your password'))
      return
    }
    // The password we just set is known-good, so sign in with it rather than bouncing
    // the user back to a form to retype it.
    const { error: signInError } = await authClient.signIn.email({ email, password: newPassword })
    setLoading(false)
    if (signInError) {
      switchMode('password')
      setNotice('Password updated. Sign in with it below.')
      return
    }
    navigate({ to: '/dashboard' })
  }

  const heading =
    mode === 'reset-request' || mode === 'reset-verify' ? 'Set a new password' : 'Sign in'
  const sub =
    mode === 'reset-request'
      ? "We'll email you a code. This works too if you've only ever used Google and want a password."
      : mode === 'reset-verify' || mode === 'code-verify'
        ? null
        : 'Welcome back to Custodian.'

  return (
    <AuthShell>
      <h1 className="font-display text-[32px] font-semibold text-ink">{heading}</h1>
      {sub && <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{sub}</p>}

      {(mode === 'code-verify' || mode === 'reset-verify') && (
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          If an account exists for <span className="font-medium text-ink">{email}</span>, we've sent
          it a 6-digit code. It expires in 5 minutes.
        </p>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      {mode === 'password' && (
        <div className="mt-7 space-y-5">
          <GoogleButton onClick={handleGoogle} loading={googleLoading} label="Continue with Google" />
          <Divider>or</Divider>

          <form onSubmit={handlePasswordSignIn} className="space-y-4">
            <AuthInput
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@foundation.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <MethodToggle mode="password" onChange={() => switchMode('code-request')} />

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="password" className="text-[13px] font-medium text-ink-soft">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => switchMode('reset-request')}
                  className="text-[13px] font-medium text-moss-700 hover:text-moss-600"
                >
                  Forgot?
                </button>
              </div>
              <AuthInput
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <AuthButton loading={loading} loadingLabel="Signing in…">
              Sign in
            </AuthButton>
          </form>
        </div>
      )}

      {mode === 'code-request' && (
        <div className="mt-7 space-y-5">
          <GoogleButton onClick={handleGoogle} loading={googleLoading} label="Continue with Google" />
          <Divider>or</Divider>

          <form onSubmit={handleRequestCode} className="space-y-4">
            <AuthInput
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@foundation.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <MethodToggle mode="code" onChange={() => switchMode('password')} />
            <p className="text-[13px] leading-relaxed text-ink-muted">
              We'll email you a 6-digit code — no password needed.
            </p>
            <AuthButton loading={loading} loadingLabel="Sending…">
              Email me a code
            </AuthButton>
          </form>
        </div>
      )}

      {mode === 'code-verify' && (
        <form onSubmit={handleVerifyCode} className="mt-7 space-y-5">
          <CodeInput value={otp} onChange={setOtp} label="6-digit sign-in code" autoFocus />
          <AuthButton loading={loading} loadingLabel="Signing in…" disabled={otp.length !== 6}>
            Sign in
          </AuthButton>
          <BackLink onClick={() => switchMode('code-request')}>
            Use a different email, or send a new code
          </BackLink>
        </form>
      )}

      {mode === 'reset-request' && (
        <form onSubmit={handleRequestReset} className="mt-7 space-y-4">
          <AuthInput
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@foundation.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <AuthButton loading={loading} loadingLabel="Sending…">
            Email me a reset code
          </AuthButton>
          <BackLink onClick={() => switchMode('password')}>Back to sign in</BackLink>
        </form>
      )}

      {mode === 'reset-verify' && (
        <form onSubmit={handleResetPassword} className="mt-7 space-y-5">
          <CodeInput value={otp} onChange={setOtp} label="6-digit reset code" autoFocus />
          <AuthInput
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <AuthButton
            loading={loading}
            loadingLabel="Updating…"
            disabled={otp.length !== 6 || !newPassword}
          >
            Set password and sign in
          </AuthButton>
          <BackLink onClick={() => switchMode('reset-request')}>
            Use a different email, or send a new code
          </BackLink>
        </form>
      )}
    </AuthShell>
  )
}

/**
 * The two email-based methods, as one explicit control. Google sits above the divider
 * because it's a different kind of choice — a provider, not a credential.
 */
function MethodToggle({ mode, onChange }: { mode: 'password' | 'code'; onChange: () => void }) {
  const base =
    'flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150'
  return (
    <div className="flex gap-1 rounded-xl border border-hairline bg-moss-50 p-1" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'password'}
        onClick={mode === 'password' ? undefined : onChange}
        className={
          mode === 'password'
            ? `${base} bg-white text-ink shadow-sm`
            : `${base} text-ink-muted hover:text-ink-soft`
        }
      >
        Password
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'code'}
        onClick={mode === 'code' ? undefined : onChange}
        className={
          mode === 'code'
            ? `${base} bg-white text-ink shadow-sm`
            : `${base} text-ink-muted hover:text-ink-soft`
        }
      >
        Email code
      </button>
    </div>
  )
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-[13px] text-ink-muted hover:text-ink"
    >
      {children}
    </button>
  )
}
