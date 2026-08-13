import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  LockKeyIcon,
  SearchRemoveIcon,
  UserLock01Icon,
} from '@hugeicons/core-free-icons'
import { messageFor, serverStackOf, statusOf } from '../../lib/errors'
import { Button } from './Button'
import { cn } from './cn'

type Face = {
  icon: typeof Alert02Icon
  title: string
  /** Used when the error carries no message of its own. */
  body: string
  tint: string
}

/**
 * One face per status, so a missing grant and a cross-tenant one never read as "the
 * app is broken". A 403 in particular should feel deliberate — it is the tenancy rules
 * working, not a fault.
 */
const FACES: Record<number, Face> = {
  404: {
    icon: SearchRemoveIcon,
    title: "We couldn't find that",
    body: 'It may have been deleted, or the link may be wrong.',
    tint: 'bg-grey-100 text-grey-500',
  },
  403: {
    icon: LockKeyIcon,
    title: 'That belongs to another organisation',
    body: "You can only see records belonging to your own foundation.",
    tint: 'bg-warning/10 text-warning',
  },
  401: {
    icon: UserLock01Icon,
    title: 'Please sign in again',
    body: 'Your session has expired.',
    tint: 'bg-warning/10 text-warning',
  },
  500: {
    icon: Alert02Icon,
    title: 'Something went wrong at our end',
    body: 'This has been reported. Trying again often works.',
    tint: 'bg-danger/10 text-danger',
  },
}

function faceFor(status: number): Face {
  if (FACES[status]) return FACES[status]
  if (status >= 400 && status < 500) return FACES[404]!
  return FACES[500]!
}

export type ErrorStateProps = {
  error: unknown
  /** Retry handler. Usually `router.invalidate()` — omit to hide the button. */
  onRetry?: () => void
  /** `panel` is the compact form used inside a section boundary. */
  variant?: 'page' | 'panel'
  /** Overrides the status-derived heading (e.g. naming the failed section). */
  title?: string
  className?: string
}

/**
 * The single error face for the whole app — route boundaries, panel boundaries and
 * not-found all render this.
 */
export function ErrorState({
  error,
  onRetry,
  variant = 'page',
  title,
  className,
}: ErrorStateProps) {
  const status = statusOf(error)
  const face = faceFor(status)
  const detail = messageFor(error)
  // Present only when the server decided this caller may see it — i.e. a superadmin.
  // The client makes no judgement of its own; see src/server/errors.ts.
  const trace = serverStackOf(error)
  const isPanel = variant === 'panel'

  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-card border border-dashed border-grey-200 bg-white text-center',
        isPanel ? 'px-5 py-8' : 'px-6 py-16',
        className,
      )}
      role="alert"
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full',
          face.tint,
          isPanel ? 'h-9 w-9' : 'h-12 w-12',
        )}
      >
        <HugeiconsIcon icon={face.icon} size={isPanel ? 18 : 24} strokeWidth={1.8} />
      </span>

      <h2
        className={cn(
          'font-display font-semibold text-grey-900',
          isPanel ? 'mt-3 text-body' : 'mt-5 text-heading',
        )}
      >
        {title ?? face.title}
      </h2>

      <p
        className={cn(
          'mt-1.5 max-w-md leading-relaxed text-grey-500',
          isPanel ? 'text-body' : 'text-body',
        )}
      >
        {status === 500 ? face.body : detail}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button variant={isPanel ? 'secondary' : 'primary'} size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {status === 401 ? (
          <Link to="/sign-in">
            <Button variant="primary" size="sm">
              Sign in
            </Button>
          </Link>
        ) : null}
        {!isPanel && status !== 401 ? (
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">
              Back to dashboard
            </Button>
          </Link>
        ) : null}
      </div>

      {trace ? (
        <details className="mt-6 w-full text-left">
          <summary className="cursor-pointer text-label font-medium text-grey-500 hover:text-grey-900">
            Technical detail (superadmin only)
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-chip bg-grey-900 p-3 text-left text-label leading-relaxed text-grey-100">
            {trace}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
