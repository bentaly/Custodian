import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkSquare02Icon,
  MinusSignSquareIcon,
  SquareIcon,
} from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'

// The app's checkbox, drawn as the Figma draws it (applications table, node 191:14900).
//
// It is NOT a bordered box: the design names a Hugeicons glyph, `checkmark-square-02` at
// 20px in Semantic/Success, dimmed to 30% unchecked. `SquareIcon` and `MinusSignSquareIcon`
// carry a byte-identical outer path, so all three states are one squircle with a different
// mark inside rather than three drawings. That is also why the control takes no radius
// token — an icon has no border-radius.
//
// A REAL `<input type="checkbox">` does the work; the glyph is decoration layered over it.
// The earlier version was a `<button>`, which is valid ARIA with `role="checkbox"` but
// gives up things the native control has for free: Space-to-toggle with Enter correctly
// ignored, `indeterminate`, form participation, and the label/`for` association that makes
// the text beside it part of the hit target. None of that is worth reimplementing.
//
// `indeterminate` is a DOM *property*, not an attribute — React cannot set it from JSX, so
// it is applied via ref. It is what the "select all" header shows when only some rows are
// selected; without it that box reads as "nothing selected", which is a lie.

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  /** Renders beside the box and is part of the hit target. Omit for a bare box — then
   *  `aria-label` is required, since a checkbox with no name is unusable by screen reader. */
  label?: ReactNode
  /** Some-but-not-all state. Shows a dash and announces as `mixed`. */
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, className, checked, disabled, ...props },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inner.current
    if (el) el.indeterminate = indeterminate
  }, [indeterminate])

  const icon = indeterminate
    ? MinusSignSquareIcon
    : checked
      ? CheckmarkSquare02Icon
      : SquareIcon

  return (
    <label
      className={cn(
        'inline-flex items-center gap-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        {...props}
        ref={(node) => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-chip transition-opacity',
          // The ring is the app's field-focus treatment (see `fields.tsx`). The comps
          // define no focus state at all — flagged with the designer.
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand/20',
          checked || indeterminate ? '' : 'opacity-30',
        )}
      >
        <HugeiconsIcon icon={icon} size={20} color={C.success} />
      </span>
      {label != null && <span className="font-display text-body text-gray-900">{label}</span>}
    </label>
  )
})
