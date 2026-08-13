import { useEffect, useRef, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'

// The app's modal shell, drawn as the round dialog draws it (Figma 674:32922): a white
// 16px-radius panel on a dimmed page, a 20px title with a 12px line under it, and a
// grey square close button in the top-right corner.
//
// Everything that makes a dialog a dialog lives here rather than in each caller, because
// the failure modes are identical every time: Escape and the backdrop must back out, but
// NEITHER may while the action is in flight — a half-finished save must not lose the
// panel that is about to report whether it worked. Focus moves into the panel on open
// and returns to whatever opened it on close, and the page behind it stops scrolling.

export function Dialog({
  open,
  title,
  description,
  onClose,
  busy = false,
  size = 'md',
  children,
  footer,
}: {
  open: boolean
  title: string
  /** The one line under the title explaining what this dialog is for. */
  description?: ReactNode
  onClose: () => void
  /** While true, Escape and the backdrop are inert and the close button is disabled. */
  busy?: boolean
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  /** Pinned below the scrolling body, so the primary action never scrolls out of reach. */
  footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    // The panel itself is the focus target, not the first field: a dialog that opens
    // with the cursor already in a text box reads to a screen reader as a form with no
    // title, and steals the keyboard from anyone who only wanted to read it.
    panel.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Decorative: `aria-hidden` keeps the backdrop out of the accessibility tree, and
          the Escape handler above — not a click on a div — is what gives keyboard users
          the same way out. A sibling of the panel rather than its parent, so no click
          has to be stopped from propagating. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40"
        onClick={() => !busy && onClose()}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-6 rounded-card border bg-white p-6 shadow-xl focus:outline-hidden',
          width,
        )}
        style={{ borderColor: C.line }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-heading font-medium text-grey-900">{title}</h2>
            {description && <p className="font-display text-label text-grey-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex shrink-0 rounded-chip bg-grey-100 p-2.5 transition-colors hover:bg-grey-200 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden disabled:opacity-50"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={20} color={C.ink} />
          </button>
        </div>

        {/* The body scrolls, the header and footer do not — a round with a dozen
            programmes must not push Save off the bottom of the screen. */}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>

        {footer}
      </div>
    </div>
  )
}
