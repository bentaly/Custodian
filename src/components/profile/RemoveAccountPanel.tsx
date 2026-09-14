import { useState } from 'react'
import { authClient } from '../../lib/auth-client'
import { invalidateCurrentUser } from '../../lib/currentUser'
import { confirmAccountRemoval, requestAccountRemovalCode } from '../../server/fns/team'
import { Button, Dialog, ErrorNote, Panel, PanelTitle } from '../ui'
import { CodeInput } from '../ui/CodeInput'
import { C } from '../ui/tokens'

/**
 * Remove your own account, confirmed with an emailed code (see `lib/removalCode.ts`).
 *
 * Last on the Profile and quiet until pressed: the button is the only red thing on the
 * page. The copy says plainly what is KEPT, because "delete my account" sets an
 * expectation that everything goes, and a trustee's votes do not.
 */
export function RemoveAccountPanel({
  email,
  clientName,
  refusal,
}: {
  email: string
  clientName: string | null
  refusal: string | null
}) {
  const org = clientName ?? 'your foundation'
  const [open, setOpen] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function close() {
    if (busy) return
    setOpen(false)
    setCodeSent(false)
    setCode('')
    setError('')
  }

  async function handleSendCode() {
    setBusy(true)
    setError('')
    try {
      await requestAccountRemovalCode()
      setCode('')
      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm() {
    setBusy(true)
    setError('')
    try {
      await confirmAccountRemoval({ data: { code } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove your account.')
      setBusy(false)
      return
    }
    // The server has already deleted every session, so this only clears the cookie.
    await authClient.signOut().catch(() => {})
    invalidateCurrentUser()
    // A full load rather than a router navigation: every loader and cached identity on
    // this tab belongs to an account that no longer exists.
    window.location.assign('/sign-in')
  }

  return (
    <Panel label="Remove account">
      <PanelTitle>Remove your account</PanelTitle>
      <div className="flex flex-col gap-3">
        <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
          Removing your account signs you out everywhere and stops you signing in to {org}. Your
          votes, comments and past activity stay on record under your name, because they are part of
          how {org} made its decisions. An admin can invite you again later.
        </p>
        {refusal ? (
          <p className="font-display text-body leading-relaxed" style={{ color: C.ink }}>
            {refusal}
          </p>
        ) : (
          <div>
            <Button variant="danger" onClick={() => setOpen(true)}>
              Remove my account
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={open}
        title="Remove your account?"
        onClose={close}
        busy={busy}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            {codeSent ? (
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirm}
                disabled={busy || code.length !== 6}
              >
                {busy ? 'Removing…' : 'Remove my account'}
              </Button>
            ) : (
              <Button size="sm" onClick={handleSendCode} disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
            )}
          </div>
        }
      >
        {codeSent ? (
          <div className="flex flex-col gap-4">
            <p className="font-display text-body leading-relaxed text-grey-500">
              We've sent a 6-digit code to{' '}
              <span className="font-medium text-grey-900">{email}</span>. Enter it to remove your
              account. It expires in 5 minutes.
            </p>
            <CodeInput value={code} onChange={setCode} label="6-digit code" autoFocus />
            <div>
              <Button variant="text" size="sm" onClick={handleSendCode} disabled={busy}>
                Send a new code
              </Button>
            </div>
          </div>
        ) : (
          <p className="font-display text-body leading-relaxed text-grey-500">
            To confirm it's you, we'll email a 6-digit code to{' '}
            <span className="font-medium text-grey-900">{email}</span>. This cannot be undone.
          </p>
        )}
        <ErrorNote error={error} className="mt-3" />
      </Dialog>
    </Panel>
  )
}
