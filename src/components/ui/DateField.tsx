import { forwardRef, type InputHTMLAttributes } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Calendar03Icon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'

// A single date, in the app's field vocabulary — the `Opens` / `Closes` boxes on the
// round dialog. `DateRangePicker` is two of these side by side; this is the one to reach
// for whenever only one date is being captured.
//
// It is `<input type="date">`, so the calendar, the locale-correct display format and
// the keyboard handling are the browser's rather than ours. The only thing overridden is
// the picker button: Chrome draws a tiny grey glyph, Safari draws none, and Firefox
// draws none — so the native indicator is made transparent and stretched across the
// whole box, and OUR calendar icon is painted underneath it. The result is one
// affordance that looks identical in every browser and opens the picker from a click
// anywhere in the field, with no `showPicker()` call to feature-detect.

export type DateFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { className, disabled, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'relative flex h-10 w-full items-center rounded-control border border-gray-200 bg-white pr-3 pl-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20',
        disabled && 'opacity-50',
        className,
      )}
    >
      <input
        {...props}
        ref={ref}
        type="date"
        disabled={disabled}
        className="w-full bg-transparent font-display text-body text-gray-900 focus:outline-hidden [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-auto [&::-webkit-calendar-picker-indicator]:w-auto [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
      <HugeiconsIcon
        icon={Calendar03Icon}
        size={16}
        color={C.faint}
        className="pointer-events-none shrink-0"
      />
    </div>
  )
})
