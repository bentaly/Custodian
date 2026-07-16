import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'
import { cn } from './cn'

/**
 * Form furniture for the signed-out screens only.
 *
 * Deliberately separate from `ui/Button` + `ui/fields`: those are used on every screen
 * in the app, and the auth pages are the first surface built to the new design. Keeping
 * them apart means this redesign can't restyle the rest of the app by accident. When the
 * design tokens land properly, these should collapse back into the shared components.
 */

export function AuthInput({
  label,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const generated = useId()
  const inputId = id ?? generated
  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'w-full rounded-xl border border-hairline bg-canvas px-3.5 py-3 text-[15px] text-ink',
          'placeholder:text-ink-muted/60',
          'transition-colors duration-150',
          'focus:border-moss-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-moss-100',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function AuthButton({
  loading,
  loadingLabel,
  children,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; loadingLabel?: string }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className={cn(
        'w-full rounded-xl bg-ink px-4 py-3 text-[15px] font-medium text-white',
        'transition-colors duration-150 hover:bg-ink-soft',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-moss-100',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}

export function GoogleButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void
  loading?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex w-full items-center justify-center gap-2.5 rounded-xl border border-hairline bg-white px-4 py-3',
        'text-[15px] font-medium text-ink-soft',
        'transition-colors duration-150 hover:bg-canvas',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-moss-100',
        'disabled:opacity-50',
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
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
      {loading ? 'Redirecting to Google…' : label}
    </button>
  )
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <div className="w-full border-t border-hairline" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-white px-3 text-[13px] text-ink-muted">{children}</span>
      </div>
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mt-5 rounded-xl px-3.5 py-3 text-[14px] leading-relaxed',
        tone === 'error' ? 'bg-[#FDF0F4] text-[#A3283F]' : 'bg-moss-100 text-moss-700',
      )}
    >
      {children}
    </p>
  )
}
