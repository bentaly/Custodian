import { useEffect } from 'react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from './ui'

// Generic right-hand slide-over: backdrop, escape-to-close, sticky header.
// Shared by the application and report "view submission" drawers so they stay
// visually identical.
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  ariaLabel,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  ariaLabel: string
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-title font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-body text-gray-500">{subtitle}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={Cancel01Icon}
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </>
  )
}
