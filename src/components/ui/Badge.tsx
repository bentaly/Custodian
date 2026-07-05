import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * Pill badge. Colour comes from the caller (e.g. ROUND_STATUS_COLORS maps or
 * "bg-gray-100 text-gray-600") so existing status colour tables keep working.
 */
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', className)}
      {...props}
    />
  )
}
