import { useCallback, useRef, useState } from 'react'
import { captureException } from '@sentry/react'
import { statusOf } from './errors'
import { shouldIgnore } from './sentry'

export type Action<TArgs extends unknown[], TResult> = {
  /** Runs the action. Resolves to `undefined` if it threw — the error is in `error`. */
  run: (...args: TArgs) => Promise<TResult | undefined>
  /** True while in flight. Wire to `disabled` so the button can't be double-fired. */
  pending: boolean
  error: unknown
  reset: () => void
}

/**
 * Wraps an async action fired from an event handler — saving, awarding, inviting.
 *
 * Error boundaries cannot help here: React only catches throws from render and
 * lifecycle, so a rejected promise in an onClick would otherwise be an unhandled
 * rejection and a button that silently does nothing.
 *
 * It also enforces the disable-while-pending convention in one place rather than
 * relying on every call site to remember its own `finally`.
 */
export function useAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): Action<TArgs, TResult> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Held in a ref so `run` stays referentially stable even when the caller passes an
  // inline arrow — otherwise every parent render would give children a new callback.
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async (...args: TArgs) => {
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (err) {
      setError(err)
      // 4xx are expected and already shown to the user; only faults are worth an alert.
      if (!shouldIgnore(err) && statusOf(err) >= 500) captureException(err)
      return undefined
    } finally {
      setPending(false)
    }
  }, [])

  const reset = useCallback(() => setError(null), [])

  return { run, pending, error, reset }
}
