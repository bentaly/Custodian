import { createFileRoute } from '@tanstack/react-router'
import { withDeadline } from '../../server/deadline'

/**
 * How long BetterAuth's handler may take on a read before we stop waiting.
 *
 * This route is not a server function, so `src/start.ts`'s middleware never wrapped it
 * and until now nothing bounded it at all. That mattered: on 18 Aug 2026 a single
 * `GET /api/auth/get-session` ran for **90.7 seconds** and was cancelled without a
 * response — the longest hang in the incident, and the only request in it with no
 * deadline of any kind. Every server function beside it stopped at 20s on schedule.
 *
 * 20s matches `READ_DEADLINE_MS`, deliberately: this is the same kind of last-resort
 * bound on the same kind of work, and one number that is obviously a backstop is worth
 * more than two finely-tuned ones that invite the question of why they differ.
 */
const AUTH_READ_DEADLINE_MS = 20_000

/**
 * **GET only.** POSTs to `/api/auth/*` are sign-in, sign-up and password reset — writes,
 * where abandoning the wait would leave the caller unable to tell whether the account
 * changed. Same rule, and the same reason, as the server-fn deadline and `db.ts`.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { getAuth } = await import('../../server/auth')
        try {
          return await withDeadline(
            Promise.resolve(getAuth().handler(request)),
            AUTH_READ_DEADLINE_MS,
            () => new Error(`auth handler exceeded ${AUTH_READ_DEADLINE_MS}ms`),
          )
        } catch (err) {
          // Logged rather than thrown onward so the caller gets a status it can act on
          // instead of a hang. The client treats a 503 here as "no session right now",
          // which is the truth — and unlike a 401 it does not read as "signed out", so
          // nothing tears down a live session over a slow database.
          console.error('[auth] handler failed:', err)
          return new Response(JSON.stringify({ error: 'auth_unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const { getAuth } = await import('../../server/auth')
        return getAuth().handler(request)
      },
    },
  },
} as any)
