import { useState } from 'react'
import { authClient } from '../../lib/auth-client'
import { Button, ErrorNote, Input, Label, Panel, PanelTitle } from '../ui'
import { CodeInput } from '../ui/CodeInput'
import { C } from '../ui/tokens'

const OTP_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Check it and try again.",
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Send a new code.',
}

function authMessage(err: { code?: string; message?: string }, fallback: string) {
  return (err.code && OTP_ERROR_MESSAGES[err.code]) ?? err.message ?? fallback
}

/**
 * Change your password, or set one if you have only ever used Google or a code.
 *
 * Changing it signs you out everywhere else, always rather than as a checkbox: the
 * commonest reason to change a password is suspecting somebody else has it, and a
 * default that leaves their session open is the wrong one for that person.
 *
 * Setting one goes through the emailed reset code (`emailOtp.resetPassword`), which is
 * the only BetterAuth route that creates a `credential` account for an OAuth-only user.
 * Either way `auth.ts` emails the account holder that the password changed.
 */
export function PasswordPanel({
  email,
  hasPassword,
  onChanged,
}: {
  email: string
  hasPassword: boolean
  onChanged: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [otp, setOtp] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function reset() {
    setCurrent('')
    setNext('')
    setOtp('')
    setCodeSent(false)
  }

  async function handleChange(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: err } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      if (err) {
        setError(authMessage(err, 'Could not change your password.'))
        return
      }
      reset()
      setNotice('Password changed. You have been signed out everywhere else.')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function handleSendCode() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: err } = await authClient.emailOtp.requestPasswordReset({ email })
      if (err) {
        setError(authMessage(err, 'Could not send a code. Please try again.'))
        return
      }
      setCodeSent(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleSet(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { error: err } = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password: next,
      })
      if (err) {
        setError(authMessage(err, 'Could not set your password.'))
        return
      }
      reset()
      setNotice('Password set. You can now sign in with your email address and password.')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel label="Password">
      <PanelTitle>Password</PanelTitle>

      {hasPassword ? (
        <form onSubmit={handleChange} className="flex flex-col gap-4">
          <div className="max-w-sm">
            <Label htmlFor="password-current">Current password</Label>
            <Input
              id="password-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="max-w-sm">
            <Label htmlFor="password-new">New password</Label>
            <Input
              id="password-new"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={8}
              required
            />
            <p className="mt-1.5 font-display text-label" style={{ color: C.faint }}>
              Changing your password signs you out on every other device.
            </p>
          </div>
          <ErrorNote error={error} />
          <div>
            <Button type="submit" disabled={busy || !current || next.length < 8}>
              {busy ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      ) : !codeSent ? (
        <div className="flex flex-col gap-3">
          <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
            You sign in with Google or an emailed code, so there is no password on your account. Set
            one to sign in with your email address and a password as well.
          </p>
          <ErrorNote error={error} />
          <div>
            <Button variant="secondary" onClick={handleSendCode} disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSet} className="flex flex-col gap-4">
          <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
            We've sent a 6-digit code to{' '}
            <span className="font-medium" style={{ color: C.ink }}>
              {email}
            </span>
            . It expires in 5 minutes.
          </p>
          <div className="max-w-sm">
            <CodeInput value={otp} onChange={setOtp} label="6-digit code" autoFocus />
          </div>
          <div className="max-w-sm">
            <Label htmlFor="password-set">New password</Label>
            <Input
              id="password-set"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || otp.length !== 6 || next.length < 8}>
              {busy ? 'Setting…' : 'Set password'}
            </Button>
            <Button variant="ghost" onClick={handleSendCode} disabled={busy}>
              Send a new code
            </Button>
          </div>
        </form>
      )}

      {notice && (
        <p
          className="mt-3 rounded-chip border px-3 py-2 font-display text-body"
          style={{ borderColor: C.brandBorder, backgroundColor: C.brandBg, color: C.brand }}
        >
          {notice}
        </p>
      )}
    </Panel>
  )
}
