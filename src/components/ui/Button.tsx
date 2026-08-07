import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from './cn'
import { C, CONTROL, type ControlSize } from './tokens'

// The app's one button, in the Figma vocabulary the dashboard / applications /
// insights screens established: 32px or 40px tall, 8px or 12px radius, `font-display`
// at 14px medium, and the single brand green — never the old Tailwind gray-900 +
// `rounded-sm` look, which is what "some screens look different" came from.
//
// Variants say what the button *is*, not what it looks like:
//
//   primary    the one action a screen exists for      solid brand
//   secondary  everything alongside it                 white, hairline border
//   tinted     a repeated, safe action (export)        brand at 10%
//   danger     destructive, and confirmed              solid red
//   dangerGhost  destructive, offered quietly          white until hovered
//   ghost      chrome — dismiss, toggle, "show more"   no border until hovered
//   text       an action with no box (edit, reveal)     brand text only
//
// `text` is deliberately NOT called `link`, and does not render an anchor. Every use of
// it is an action — reveal a bank number, open a drawer, cancel an edit — and a screen
// reader announcing "link" for something that opens a panel, or a middle-click that
// does nothing, are both worse than the plain button they actually are. For real
// navigation use `TextLink`, which looks the same and is an `<a>`.
//
// `icon` is not a variant: any variant with `icon` and no children renders square.

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tinted'
  | 'danger'
  | 'dangerGhost'
  | 'ghost'
  | 'text'
export type ButtonSize = ControlSize | 'xs'

type IconElement = Parameters<typeof HugeiconsIcon>[0]['icon']

const VARIANT: Record<ButtonVariant, { className: string; style: React.CSSProperties }> = {
  primary: {
    className: 'font-medium text-white transition-opacity hover:opacity-90',
    style: { backgroundColor: C.brand },
  },
  secondary: {
    className: 'border bg-white font-medium transition-colors hover:bg-[#F9FAFB]',
    style: { borderColor: C.line, color: C.ink },
  },
  tinted: {
    className: 'border font-medium transition-opacity hover:opacity-90',
    style: { backgroundColor: C.brandBg, borderColor: C.brandBorder, color: C.brand },
  },
  danger: {
    className: 'font-medium text-white transition-opacity hover:opacity-90',
    style: { backgroundColor: C.danger },
  },
  dangerGhost: {
    className: 'border bg-white font-medium transition-colors hover:bg-[#FDEFF2]',
    style: { borderColor: C.line, color: C.danger },
  },
  ghost: {
    className: 'font-medium transition-colors hover:bg-[#F2F4F7]',
    style: { color: C.ink },
  },
  text: {
    className: 'font-medium hover:underline',
    style: { color: C.brand },
  },
}

// `xs` is the in-table/in-card action — below the design's two control heights, kept
// because a 32px button inside a table row crowds it.
const SIZE: Record<ButtonSize, { box: string; square: string; text: string }> = {
  xs: { box: 'h-7 rounded-lg px-2.5', square: 'size-7 rounded-lg', text: 'text-[13px]' },
  sm: {
    box: `${CONTROL.sm.height} ${CONTROL.sm.radius} ${CONTROL.sm.padding}`,
    square: 'size-8 rounded-lg',
    text: CONTROL.sm.text,
  },
  md: {
    box: `${CONTROL.md.height} ${CONTROL.md.radius} ${CONTROL.md.padding}`,
    square: 'size-10 rounded-[12px]',
    text: CONTROL.md.text,
  },
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon; with no children the button renders as a square icon button. */
  icon?: IconElement
  /** Puts the icon after the label (an export arrow, a "next" chevron). */
  iconPosition?: 'left' | 'right'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    type = 'button',
    icon,
    iconPosition = 'left',
    className,
    children,
    style,
    ...props
  },
  ref,
) {
  const v = VARIANT[variant]
  const s = SIZE[size]
  const iconOnly = icon != null && children == null
  const iconSize = size === 'md' ? 18 : 16

  // A text button has no box: no height, no padding, no radius — otherwise it cannot
  // sit inside a sentence or under a paragraph.
  const box = variant === 'text' ? '' : iconOnly ? s.square : s.box

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-display disabled:cursor-not-allowed disabled:opacity-50',
        s.text,
        box,
        v.className,
        className,
      )}
      style={{ ...v.style, ...style }}
      {...props}
    >
      {icon && iconPosition === 'left' && (
        <HugeiconsIcon icon={icon} size={iconSize} color="currentColor" />
      )}
      {children}
      {icon && iconPosition === 'right' && (
        <HugeiconsIcon icon={icon} size={iconSize} color="currentColor" />
      )}
    </button>
  )
})
