import { Button } from './Button'
import { Dialog } from './Dialog'

// The "are you sure?" step in front of an action that cannot be taken back. A thin
// preset over `Dialog` — the modal behaviour (Escape, backdrop, focus, scroll lock, and
// the rule that none of it applies while the action is in flight) lives there, so a
// confirm and a form dialog can never drift apart.

export function ConfirmDialog({
  open,
  title,
  onCancel,
  onConfirm,
  confirmLabel,
  busyLabel,
  busy = false,
  tone = 'danger',
  error,
  children,
}: {
  open: boolean
  title: string
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
  /** Confirm-button text while the action runs; defaults to `confirmLabel`. */
  busyLabel?: string
  busy?: boolean
  /**
   * What the confirm button is about.
   *
   * `danger` (the default) is for an act that DESTROYS something — deleting, cancelling,
   * rolling an import back. `primary` is for one that is merely irreversible: sending an
   * award letter is a normal part of the job, and dressing it in red teaches people that
   * red here means nothing much, which is exactly what the delete buttons cannot afford.
   */
  tone?: 'danger' | 'primary'
  error?: string
  /** What is about to happen, in the user's own nouns. */
  children: React.ReactNode
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="font-display text-body text-grey-500">{children}</div>
      {error && <p className="mt-3 font-display text-body text-danger">{error}</p>}
    </Dialog>
  )
}
