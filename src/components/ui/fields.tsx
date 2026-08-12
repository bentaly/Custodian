import { forwardRef } from 'react'
import type { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'
import { Listbox, type ListboxOption } from './Listbox'

// Form fields in the Figma vocabulary the app's controls share: a 40px box, 12px radius,
// `font-display` at 14px, and a brand focus ring.
//
// The surface is the Gray/100 WASH, not white on a hairline (Figma 674:32922) — the same
// fill the app header's global search and `SearchInput` already wore, which is what makes
// "type into this" one gesture across the app instead of two. A white field on a white
// card is a rectangle you have to find; the wash is the field. The hairline border went
// with it: on a filled box it is a second edge drawn over the first.

/** The one field surface. Exported so bespoke composite fields sit on the same box. */
export const FIELD_SURFACE =
  'w-full rounded-control bg-gray-100 px-3 font-display text-body text-gray-900 placeholder:text-gray-500 focus:outline-hidden focus:ring-2 focus:ring-brand/20 disabled:opacity-50'

const INPUT_CLASSES = `h-10 ${FIELD_SURFACE}`
const TEXTAREA_CLASSES = `py-2.5 ${FIELD_SURFACE}`

const LABEL_CLASSES = 'mb-1.5 block font-display text-body font-medium text-gray-700'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(INPUT_CLASSES, className)} {...props} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(TEXTAREA_CLASSES, className)} {...props} />
})

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn(LABEL_CLASSES, className)} {...props} />
}

/**
 * The in-form dropdown — the same box as `Input`, opening the app's `Listbox` panel.
 *
 * It takes `options` rather than `<option>` children because it is no longer a native
 * `<select>`: there is nowhere for an `<option>` element to go. A `placeholder` becomes
 * the empty-valued first row, which is how "Select programme" is offered.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder,
  id,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  options: ListboxOption[]
  value: string | undefined
  onChange: (value: string) => void
  /** Offers an empty-valued first row with this label. */
  placeholder?: string
  id?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  const all = placeholder !== undefined ? [{ value: '', label: placeholder }, ...options] : options
  return (
    <Listbox
      className={className}
      options={all}
      value={value ?? ''}
      onChange={onChange}
      ariaLabel={ariaLabel}
      disabled={disabled}
      renderTrigger={({ open, selected, props }) => (
        <button
          {...props}
          id={id}
          className={cn(
            INPUT_CLASSES,
            'flex cursor-pointer items-center gap-2 text-left',
            open && 'ring-2 ring-brand/20',
          )}
        >
          <span
            className={cn('flex-1 truncate', !selected?.value && 'text-gray-500')}
            style={{ color: selected?.value ? C.ink : undefined }}
          >
            {selected?.label ?? placeholder ?? '—'}
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.ink} className="shrink-0" />
        </button>
      )}
    />
  )
}
