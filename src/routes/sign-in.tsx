import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'
import { invalidateCurrentUser } from '../lib/currentUser'
import { DEFAULT_LANDING, oauthCallback, safeReturnPath, signInPath } from '../lib/signInRedirect'
import { AuthShell } from '../components/AuthShell'
import { CodeInput } from '../components/ui/CodeInput'
import { Button, Label, Tabs } from '../components/ui'
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
  // `redirect` is vetted HERE rather than at each use, so an unusable value is dropped
  // at the door and every path below can treat what it reads as safe to navigate to.
  // See `safeReturnPath` for why a leading slash is not enough of a check.
  validateSearch: (search: Record<string, unknown>): { error?: string; redirect?: string } => ({
    error: typeof search['error'] === 'string' ? search['error'] : undefined,
    redirect: safeReturnPath(search['redirect']) ?? undefined,
  }),
  component: SignInPage,
})

function SignInPage() {
  const { error: oauthError, redirect: returnTo } = Route.useSearch()
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

  // Where a successful sign-in lands. `returnTo` is set when the user was bounced out
  // of somewhere — a 401 mid-page, or the `_authenticated` guard — and absent when they
  // came to /sign-in deliberately, which is the only time the dashboard is the right
  // answer. A full navigation rather than `navigate()`: the returned-to route needs its
  // loaders run against the new session, not the ones cached under the old one.
  const landing = returnTo ?? DEFAULT_LANDING
  const goToLanding = () => {
    invalidateCurrentUser()
    window.location.href = landing
  }

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
    // The cached identity belongs to whoever was here before; `goToLanding` clears it.
    else goToLanding()
  }

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    const { error } = await authClient.signIn.social({
      provider: 'google',
      // The round trip through Google is a full page load, so the return path cannot be
      // held in memory — it goes to BetterAuth as the callback and comes back as a
      // navigation. On failure we return to a /sign-in that still remembers it, so the
      // user can fall back to a password and still finish where they meant to.
      callbackURL: oauthCallback(landing, DEFAULT_LANDING),
      errorCallbackURL: oauthCallback(returnTo ? signInPath(returnTo) : '/sign-in', '/sign-in'),
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
    // The cached identity belongs to whoever was here before; `goToLanding` clears it.
    else goToLanding()
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
    goToLanding()
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
      <h1 className="font-display text-display font-semibold text-grey-900">{heading}</h1>
      {sub && <p className="mt-2 text-body leading-relaxed text-grey-500">{sub}</p>}

      {(mode === 'code-verify' || mode === 'reset-verify') && (
        <p className="mt-2 text-body leading-relaxed text-grey-500">
          If an account exists for <span className="font-medium text-grey-900">{email}</span>, we've
          sent it a 6-digit code. It expires in 5 minutes.
        </p>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      {mode === 'password' && (
        <div className="mt-7 space-y-5">
          <GoogleButton
            onClick={handleGoogle}
            loading={googleLoading}
            label="Continue with Google"
          />
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
              {/* The label keeps its own bottom margin, so the row needs none. */}
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">Password</Label>
                <Button type="button" variant="text" onClick={() => switchMode('reset-request')}>
                  Forgot?
                </Button>
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
          <GoogleButton
            onClick={handleGoogle}
            loading={googleLoading}
            label="Continue with Google"
          />
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
            <p className="text-body leading-relaxed text-grey-500">
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
 *
 * It is the app's `Tabs`, not a pair of buttons drawn here: this is precisely the
 * control Tabs is — a washed track with the chosen option lifted to white on a hairline
 * — and the copy of it that used to live here had drifted to its own track colour
 * (`bg-brand/5`) and its own shadow.
 */
function MethodToggle({ mode, onChange }: { mode: 'password' | 'code'; onChange: () => void }) {
  return (
    <Tabs
      ariaLabel="How to sign in"
      value={mode}
      onChange={(next) => next !== mode && onChange()}
      // Full width: this sits in a column of full-width fields, and a track hugging
      // two short words reads as a stray chip rather than as one of the fields.
      fullWidth
      items={[
        { id: 'password' as const, label: 'Password' },
        { id: 'code' as const, label: 'Email code' },
      ]}
    />
  )
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} className="w-full">
      {children}
    </Button>
  )
}
