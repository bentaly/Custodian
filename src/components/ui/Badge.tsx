import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * Pill badge. Colour comes from the caller (e.g. ROUND_STATUS_COLOURS maps or
 * "bg-grey-100 text-grey-600") so existing status colour tables keep working.
 *
 * The comps run two sizes on purpose, and the difference is what the pill is about:
 *
 * - `default` (12px) — the status of the thing the row, card or screen IS. A table's
 *   Status column, a round's Open/Closed, the header pill on an application.
 * - `sm` (10px) — a pill annotating one line item inside a card: an instalment's Paid /
 *   Due next, a trustee's vote in the roster, a per-grant Ready in the award wizard.
 *   At default size these compete with the figure or name they sit beside, which is the
 *   line the eye is meant to land on.
 */
export function Badge({
  className,
  size = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { size?: 'default' | 'sm' }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-micro' : 'px-2 py-0.5 text-label',
        className,
      )}
      {...props}
    />
  )
}
