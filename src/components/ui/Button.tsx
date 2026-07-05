import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'link'
  | 'danger'
  | 'dangerOutline'
  | 'icon'
export type ButtonSize = 'xs' | 'sm' | 'md'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50',
  secondary:
    'rounded border border-gray-200 bg-white font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50',
  ghost: 'rounded text-gray-500 hover:bg-gray-50 disabled:opacity-50',
  link: 'font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50',
  danger: 'rounded bg-red-600 font-medium text-white hover:bg-red-700 disabled:opacity-50',
  dangerOutline:
    'rounded border border-gray-200 font-medium text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50',
  icon: 'rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'px-3 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

// Link buttons are text-only; icon buttons carry their own padding.
const TEXT_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-sm',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', type = 'button', className, ...props },
  ref,
) {
  const sizeClasses =
    variant === 'icon' ? '' : variant === 'link' ? TEXT_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size]
  return (
    <button
      ref={ref}
      type={type}
      className={cn(VARIANT_CLASSES[variant], sizeClasses, className)}
      {...props}
    />
  )
})
