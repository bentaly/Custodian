import { useEffect } from 'react'
import { Button } from './Button'

// The "are you sure?" step in front of a destructive action. Shared because every one
// of them has to behave identically: Escape and the backdrop back out, but neither does
// while the action is in flight — a half-finished delete must not lose the dialog that
// is about to report whether it worked.

export function ConfirmDialog({
  open,
  title,
  onCancel,
  onConfirm,
  confirmLabel,
  busyLabel,
  busy = false,
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
  error?: string
  /** What is about to happen, in the user's own nouns. */
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* The backdrop is decorative: `aria-hidden` keeps it out of the accessibility
          tree, and the Escape handler above — not a click on a div — is what gives
          keyboard users the same way out. It is a sibling of the panel rather than its
          parent, so no click has to be stopped from propagating. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40"
        onClick={() => !busy && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-card bg-white p-4 shadow-xl"
      >
        <h2 className="text-body font-semibold text-gray-900">{title}</h2>
        <div className="mt-2 text-body text-gray-500">{children}</div>
        {error && <p className="mt-3 text-body text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
