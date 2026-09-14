import { useState } from 'react'
import { authClient } from '../../lib/auth-client'
import { fmtDate } from '../../lib/format'
import { Button, ErrorNote, Panel, PanelTitle } from '../ui'
import { C } from '../ui/tokens'

type Session = {
  id: string
  device: string
  current: boolean
  signedInAt: Date | string
  lastActiveAt: Date | string
}

/**
 * Where you are signed in, and the one control that matters: sign out everywhere else.
 *
 * No per-session sign-out. The case this panel exists for is "a session I don't
 * recognise", and the right response to that is to end all of them and change the
 * password, not to guess which row was the stranger.
 */
export function SessionsPanel({
  sessions,
  onChanged,
}: {
  sessions: Session[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const others = sessions.filter((s) => !s.current).length

  async function handleRevokeOthers() {
    setBusy(true)
    setError('')
    try {
      const { error: err } = await authClient.revokeOtherSessions()
      if (err) {
        setError(err.message ?? 'Could not sign out your other devices.')
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel label="Signed in">
      <PanelTitle
        right={
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRevokeOthers}
            disabled={busy || others === 0}
          >
            {busy ? 'Signing out…' : 'Sign out of other devices'}
          </Button>
        }
      >
        Where you're signed in
      </PanelTitle>
      <ul className="flex flex-col">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t py-3 first:border-t-0 first:pt-0"
            style={{ borderColor: C.wash }}
          >
            <span className="font-display text-body font-medium" style={{ color: C.ink }}>
              {s.device}
              {s.current && (
                <span className="ml-2 font-normal" style={{ color: C.brand }}>
                  This device
                </span>
              )}
            </span>
            <span className="font-display text-body" style={{ color: C.sub }}>
              Signed in {fmtDate(s.signedInAt)} · last active {fmtDate(s.lastActiveAt)}
            </span>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} className="mt-3" />
    </Panel>
  )
}
