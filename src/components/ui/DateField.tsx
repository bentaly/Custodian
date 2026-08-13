import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HugeiconsIcon } from '@hugeicons/react'
import { Calendar03Icon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'
import { CalendarPanel, fmtDay, iso, parseIso, startOfMonth } from './calendar'
import { useAnchoredPopover, useDismiss } from './popover'

// A single date, in the app's field vocabulary — the `Opens` / `Closes` boxes on the
// round dialog, the award wizard's start and instalment dates.
//
// It used to be `<input type="date">` with the native indicator stretched across the
// box, which meant every browser drew a different calendar and none of them ours. It now
// opens the SAME `CalendarPanel` the range picker does, so a date is picked the same way
// wherever the app asks for one.
//
// A hidden `type="date"` input still sits behind the trigger carrying `id`, `name`,
// `required` and `min`/`max`. It is not how anyone picks a date — it is how the field
// stays part of its form: `required` is enforced and reported by the browser, at the
// control's own position, without the dialog having to re-implement validation.

export type DateFieldProps = {
  /** `yyyy-mm-dd`, or empty for no date. */
  value: string
  onChange: (value: string) => void
  /** Inclusive `yyyy-mm-dd` bounds; days outside them can't be picked. */
  min?: string
  max?: string
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  /** `sm` (32px) for inline row editors, `md` (40px) for form fields. */
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

export function DateField({
  value,
  onChange,
  min,
  max,
  id,
  name,
  required,
  disabled,
  placeholder = 'Select a date',
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => startOfMonth(value ? parseIso(value) : new Date()))
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pos = useAnchoredPopover(open, rootRef, popRef)

  // The calendar takes focus when it opens, so closing MUST hand it back — otherwise a
  // keyboard user picks a date and the next Tab starts from the top of the document.
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  useDismiss(open, close, rootRef, popRef)

  // Reopening always lands on the month the committed value is in, not wherever the
  // user had paged to before backing out.
  useEffect(() => {
    if (open) setMonth(startOfMonth(value ? parseIso(value) : new Date()))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const box = size === 'sm' ? 'h-8 rounded-chip px-2.5 gap-2' : 'h-10 rounded-control px-3 gap-2'

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* Not the picker — the form participation. `pointer-events-none` and
          `tabIndex={-1}` keep it out of everyone's way; `onChange` (rather than
          `readOnly`) because a read-only input is barred from constraint validation,
          which is the entire reason it is here. */}
      <input
        type="date"
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'relative flex w-full items-center bg-grey-100 font-display text-body focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden',
          box,
          disabled && 'opacity-50',
          open && 'ring-2 ring-brand/20',
        )}
      >
        <span
          className={cn('flex-1 truncate text-left', value ? 'text-grey-900' : 'text-grey-500')}
        >
          {value ? fmtDay(value) : placeholder}
        </span>
        <HugeiconsIcon icon={Calendar03Icon} size={16} color={C.faint} className="shrink-0" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel ?? 'Select a date'}
            className="fixed z-[60] flex flex-col items-center gap-3 rounded-card border bg-white p-3 shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)]"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              borderColor: C.line,
              // Hidden until measured, so it never paints for a frame in the corner.
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <CalendarPanel
              autoFocus
              month={month}
              onMonthChange={setMonth}
              toneFor={(d) => (d === value ? 'selected' : 'none')}
              isDisabled={(d) => (min != null && d < min) || (max != null && d > max)}
              onPick={(d) => {
                onChange(iso(d))
                close()
              }}
            />
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  onChange(iso(new Date()))
                  close()
                }}
                className="flex h-8 items-center rounded-chip px-2 font-display text-body font-medium hover:bg-grey-100"
                style={{ color: C.brand }}
              >
                Today
              </button>
              {/* Only offered where a blank date is actually allowed — on a `required`
                  field a Clear button is a button that puts the form in a state it will
                  refuse to submit from. */}
              {!required && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('')
                    close()
                  }}
                  className="flex h-8 items-center rounded-chip px-2 font-display text-body font-medium hover:bg-grey-100"
                  style={{ color: C.sub }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
