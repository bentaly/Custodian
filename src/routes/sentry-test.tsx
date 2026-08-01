import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

/**
 * TEMPORARY — delete once Sentry is confirmed working.
 *
 * Deliberately unauthenticated so it can be hit on staging without a session. It
 * throws on demand and does nothing else.
 */
export const Route = createFileRoute('/sentry-test')({
  component: SentryTest,
})

const throwOnServer = createServerFn({ method: 'GET' }).handler(async () => {
  throw new Error('Sentry server test error — safe to ignore')
})

function SentryTest() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-10">
      <h1 className="text-xl font-semibold">Sentry test</h1>
      <p className="text-sm text-gray-600">
        Each button throws a deliberate error. Delete this route once events are landing.
      </p>
      <button
        className="rounded-lg border px-4 py-2 text-sm"
        onClick={() => {
          // setTimeout so the throw escapes React entirely and reaches the global
          // handler — the same path an unexpected runtime error takes.
          setTimeout(() => {
            throw new Error('Sentry browser test error — safe to ignore')
          })
        }}
      >
        Throw in the browser
      </button>
      <button
        className="rounded-lg border px-4 py-2 text-sm"
        onClick={() => {
          throwOnServer().catch(() => {})
        }}
      >
        Throw on the server
      </button>
    </div>
  )
}
