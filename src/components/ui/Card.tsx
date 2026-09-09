import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/** Bordered white panel. Padding is the caller's (e.g. className="p-4"). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-grey-200 bg-white', className)} {...props} />
}

/**
 * Dashed-border placeholder shown when a list or section has no content.
 *
 * Centring is STRUCTURAL — a column that centres its own children — not `text-center` on a
 * full-bleed block. Under `text-center` every child is centred on its own terms: a paragraph
 * centres its wrapped lines within whatever width it happens to take, while a link or button
 * centres on the box, so the copy and the thing under it sat on two different axes and the
 * state never looked quite centred. The column gives them one axis.
 *
 * The measure is capped for the same reason: uncapped, a sentence ran the full width of the
 * display as one enormous line followed by a stub. `children` is wrapped rather than the box
 * itself so a caller's own `className` still styles the frame (padding, borders, span).
 */
export function EmptyState({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-dashed border-grey-200 bg-white px-6 py-12',
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">{children}</div>
    </div>
  )
}
