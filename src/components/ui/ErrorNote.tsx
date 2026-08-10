import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { messageFor } from '../../lib/errors'
import { cn } from './cn'

/**
 * Inline failure notice for an action the user just took — saving a form, sending a
 * letter, casting a vote. Sits next to the control that failed, because that is where
 * the user is looking; a boundary would be wrong here (it would replace the form they
 * are trying to fix) and so would a toast (it disappears).
 *
 * Renders nothing when there is no error, so it can be left in the tree unconditionally.
 */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null

  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-chip border border-danger/20 bg-danger/10 px-3 py-2 text-body leading-relaxed text-danger',
        className,
      )}
      role="alert"
    >
      <HugeiconsIcon
        icon={Alert02Icon}
        size={16}
        strokeWidth={1.8}
        className="mt-px shrink-0"
      />
      <span>{messageFor(error)}</span>
    </p>
  )
}
