import { createFileRoute } from '@tanstack/react-router'
import { withDeadline } from '../../server/deadline'
import { checkRateLimit } from '../../server/rateLimit'

/**
 * How long BetterAuth's handler may take on a read before we stop waiting.
 *
 * This route is not a server function, so `src/start.ts`'s middleware never wrapped it
 * and until now nothing bounded it at all. That mattered: on 18 Aug 2026 a single
 * `GET /api/auth/get-session` ran for **90.7 seconds** and was cancelled without a
 * response — the longest hang in the incident, and the only request in it with no
 * deadline of any kind. Every server function beside it stopped at 20s on schedule.
 *
 * 12s matches `READ_DEADLINE_MS`, deliberately: this is the same kind of last-resort
 * bound on the same kind of work, and one number that is obviously a backstop is worth
 * more than two finely-tuned ones that invite the question of why they differ. Both
 * must stay under the browser's own 15s (`REQUEST_TIMEOUT_MS`) — a bound the other end
 * never waits for is not a bound, and this route is the one that produced the 90.7s
 * hang, so it is the last place that should be left above it.
 */
const AUTH_READ_DEADLINE_MS = 12_000

/**
 * **GET only.** POSTs to `/api/auth/*` are sign-in, sign-up and password reset — writes,
 * where abandoning the wait would leave the caller unable to tell whether the account
 * changed. Same rule, and the same reason, as the server-fn deadline and `db.ts`.
 */

/**
 * The `/api/auth/*` POSTs where an attacker gains something by repeating the call:
 * guessing a password, guessing a 6-digit code, or making us send mail to an address
 * of their choosing. Matched on a substring rather than an exact list because
 * BetterAuth's paths are plugin-shaped (`/email-otp/send-verification-otp`,
 * `/sign-in/email`, `/sign-in/social`, …) and a new one should be caught by default.
 */
function isCredentialPath(pathname: string): boolean {
  return (
    pathname.includes('/sign-in') ||
    pathname.includes('/sign-up') ||
    pathname.includes('/email-otp') ||
    pathname.includes('password')
  )
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { callAuth } = await import('../../server/auth')
        try {
          // `callAuth` carries its own 8s bound AND, crucially, discards a poisoned
          // auth instance so the isolate recovers — see the note on better-auth
          // #10315 there. The outer bound stays as a backstop for anything that
          // stalls outside the auth instance itself.
          return await withDeadline(
            callAuth('handler', (auth) => Promise.resolve(auth.handler(request))),
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
        // Rate-limit the credential paths before BetterAuth sees them. Nothing did
        // until the 2026-08-27 audit — 25 sign-in attempts from one IP all answered
        // 401 and never 429 — because better-auth's own limiter only self-enables on
        // NODE_ENV === "production" (unset here) and stores its counters in isolate
        // memory, which on Workers resets with every isolate.
        //
        // Only the paths where a guess is worth something. Rationing sign-out or a
        // session call would be a way to lock a legitimate user out of their own
        // account, which is the attack rather than the defence.
        if (isCredentialPath(new URL(request.url).pathname)) {
          const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
          if (!(await checkRateLimit('AUTH_IP_LIMITER', ip))) {
            return new Response(
              JSON.stringify({ error: 'Too many attempts. Try again shortly.' }),
              {
                status: 429,
                headers: { 'content-type': 'application/json', 'retry-after': '60' },
              },
            )
          }
        }

        const { getAuth } = await import('../../server/auth')
        return getAuth().handler(request)
      },
    },
  },
} as any)
