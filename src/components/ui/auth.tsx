import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { Button } from './Button'
import { Input, Label } from './fields'

/**
 * Form furniture for the signed-out screens.
 *
 * These used to be a PARALLEL kit — their own input box, their own button — built when
 * the auth pages were the first surface drawn to the new design and the rest of the app
 * was not, so keeping them apart was what stopped the redesign leaking sideways. The
 * note left here said they should collapse back into the shared components once the
 * design tokens landed properly. They landed (10–11 Aug), so they have.
 *
 * What survives is only what is genuinely particular to being signed out: a label/field
 * pairing, Google's own button, a divider and a notice. Each one now composes `Button`
 * and `fields` rather than restating them — which is what fixes the thing you could see
 * from across the room: the primary button on the app's front door was charcoal, and
 * every other primary action in the app is brand green.
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
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <Input id={inputId} className={className} {...props} />
    </div>
  )
}

/**
 * A password field with a reveal toggle.
 *
 * The eye is not decoration: every password box in this app is either a password being
 * SET (sign-up, reset) or one being typed on a phone keyboard, and the only way to
 * check what you typed without it is to clear the field and start again.
 *
 * The toggle is a `<button type="button">` — inside a form, a bare `<button>` submits —
 * and it is drawn here rather than as the shared `Button` because it sits INSIDE the
 * field box: it needs the field's own height and no chrome of its own. It is skipped in
 * the tab order (`tabIndex={-1}`) so tabbing runs field → submit, the way it does on
 * every other form in the app; it stays reachable by pointer and by screen reader.
 *
 * The type flips on the SAME element rather than swapping two inputs, so the caret,
 * the value and the browser's autofill association all survive the toggle.
 */
export function PasswordInput({
  label,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const generated = useId()
  const inputId = id ?? generated
  const [visible, setVisible] = useState(false)
  return (
    <div>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? 'text' : 'password'}
          className={cn('pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-grey-500 hover:text-grey-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand/20"
        >
          <HugeiconsIcon
            icon={visible ? ViewOffSlashIcon : ViewIcon}
            size={18}
            color="currentColor"
          />
        </button>
      </div>
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
    <Button
      type="submit"
      variant="primary"
      disabled={loading || disabled}
      className={cn('w-full', className)}
      {...props}
    >
      {loading && loadingLabel ? loadingLabel : children}
    </Button>
  )
}

/**
 * Google's button. The one place a literal hex belongs in a component: the four colours
 * below are Google's brand, not ours, and a token that changed them would be wrong.
 */
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
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={loading}
      className="w-full"
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
    </Button>
  )
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <div className="w-full border-t border-grey-200" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-white px-3 font-display text-body text-grey-500">{children}</span>
      </div>
    </div>
  )
}

/**
 * The outcome of the last attempt. Wears the same tinted box as `ErrorNote` (the inline
 * failure note used inside the app) rather than a shape of its own — a rounded-chip at
 * the 10% tint, hairline at 20%.
 */
export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mt-5 rounded-chip border px-3 py-2 font-display text-body leading-relaxed',
        tone === 'error'
          ? 'border-danger/20 bg-danger/10 text-danger'
          : 'border-brand/20 bg-brand/10 text-brand',
      )}
    >
      {children}
    </p>
  )
}
