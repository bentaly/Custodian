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
// and a brand focus ring. Before this they were `rounded-sm` with a Gray/300 border and
// a grey focus ring — which is why a form looked like a different app from the list
// screen it was launched from.
//
// `Textarea` shares the box but not the height; `Select` is the native control, used
// where a full `SelectPill` would be overkill (inside a form, next to its label).

const FIELD_BASE =
  'w-full rounded-[12px] border border-[#E4E7EC] bg-white px-3 font-display text-[14px] text-[#141C24] placeholder:text-[#97A1AF] focus:border-[#1F7A5C] focus:outline-hidden focus:ring-2 focus:ring-[#1F7A5C]/20 disabled:opacity-50'

const INPUT_CLASSES = `h-10 ${FIELD_BASE}`
const TEXTAREA_CLASSES = `py-2.5 ${FIELD_BASE}`
const SELECT_CLASSES = `h-10 cursor-pointer ${FIELD_BASE}`

const LABEL_CLASSES = 'mb-1.5 block font-display text-[13px] font-medium text-[#344051]'

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
