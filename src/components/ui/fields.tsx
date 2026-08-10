import { forwardRef } from 'react'
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from './cn'

// Form fields in the Figma vocabulary the app's controls share: a 40px box, 12px
// radius, the Gray/200 hairline every border in the app uses, `font-display` at 14px,
// and a brand focus ring. Before this they were 4px-radius with a Gray/300 border and
// a grey focus ring — which is why a form looked like a different app from the list
// screen it was launched from.
//
// `Textarea` shares the box but not the height; `Select` is the native control, used
// where a full `SelectPill` would be overkill (inside a form, next to its label).

const FIELD_BASE =
  'w-full rounded-control border border-gray-200 bg-white px-3 font-display text-body text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-hidden focus:ring-2 focus:ring-brand/20 disabled:opacity-50'

const INPUT_CLASSES = `h-10 ${FIELD_BASE}`
const TEXTAREA_CLASSES = `py-2.5 ${FIELD_BASE}`
const SELECT_CLASSES = `h-10 cursor-pointer ${FIELD_BASE}`

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

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(SELECT_CLASSES, className)} {...props} />
  },
)

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn(LABEL_CLASSES, className)} {...props} />
}
