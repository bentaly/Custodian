import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/** Bordered white panel. Padding is the caller's (e.g. className="p-5"). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-gray-200 bg-white', className)} {...props} />
}

/** Dashed-border placeholder shown when a list or section has no content. */
export function EmptyState({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-gray-200 bg-white px-6 py-12 text-center',
        className,
      )}
      {...props}
    />
  )
}
