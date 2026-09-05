import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, emailOTP } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { getDb } from './db'
import { withDeadline } from './deadline'
import { sendSignInCodeEmail, sendPasswordResetCodeEmail } from '../lib/email'
import { users, sessions, accounts, verifications } from '../../drizzle/schema'

// The admin plugin validates `adminRoles` against its access-control `roles` map
// (which otherwise only knows "admin"/"user"). Register our platform `superadmin`
// role with the full set of user/session admin permissions so it may impersonate.
const ac = createAccessControl(defaultStatements)
const superadminRole = ac.newRole({
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'impersonate-admins',
    'delete',
    'set-password',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
})

// Lazy so the module can be imported without throwing on missing env vars —
// env is only read (and validated) the first time a request needs auth.
// This prevents Cloudflare Workers' esbuild __esm module from being
// permanently poisoned if the secret is absent on first load.
// The type is inferred from `createAuth` (not the bare `betterAuth`) so the
// plugin-augmented API (admin plugin: impersonate, banned fields, …) is preserved.
let _auth: ReturnType<typeof createAuth> | undefined

export function getAuth(): ReturnType<typeof createAuth> {
  if (!_auth) {
    if (!process.env['BETTER_AUTH_SECRET']) throw new Error('BETTER_AUTH_SECRET is required')
    _auth = createAuth()
  }
  return _auth
}

/**
 * How long an auth call may take before we conclude this isolate's auth instance is
 * poisoned. Deliberately under `READ_DEADLINE_MS` (12s) so this fires first and the
 * failure is attributed here rather than to whatever server function called in.
 *
 * 5s is ~15-150x the 30-300ms these calls actually take, so a false positive is
 * implausible, and it is the longest anyone waits in the broken case. It was 8s; with
 * the pre-seed in `worker-entry.js` now preventing the stall rather than only catching
 * it, there is no reason to make somebody sit through the extra three seconds on the
 * rare path where this still fires.
 */
const AUTH_CALL_DEADLINE_MS = 5_000

/** The plugin-augmented instance, for callers that need to name its types. */
export type AuthInstance = ReturnType<typeof createAuth>

const AUTH_STALLED = 'AuthStalled' as const

export function isAuthStalled(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === AUTH_STALLED
}

/**
 * Every call into BetterAuth goes through here, because the cached instance above can
 * be poisoned for the life of the isolate — and this is the only way out of that.
 *
 * ## The bug
 *
 * `betterAuth()` builds its `$context` lazily, as a promise created inside whichever
 * request happens to touch auth first in a fresh isolate. On Cloudflare, when a client
 * disconnects, workerd cancels that request's IoContext — and **promises created in a
 * cancelled context are abandoned, not rejected**. They never settle, and nothing
 * throws. So if the request that initialised auth is aborted mid-init, `_auth.$context`
 * stays pending forever, and every later request that awaits it hangs forever too,
 * until the isolate is evicted.
 *
 * This is better-auth issue #10315, open against 1.6.25 (the version in package.json)
 * with no merged fix. Our production telemetry matches the reports in that thread
 * closely: tens of seconds of wall time against ~1-20ms of CPU, `outcome: canceled`,
 * zero errors reported, non-auth routes on the same Worker answering normally
 * throughout, and — as others in the thread also demonstrated — the database itself
 * provably healthy and serving concurrent queries.
 *
 * It also explains the shape of 18 Aug 2026: five deadline events inside one minute,
 * from one user. That is not five coincidences, it is one poisoned isolate serving
 * hang after hang.
 *
 * ## Why the fix is a timer and a reset
 *
 * The stall cannot be cancelled — an `AbortSignal` is itself bound to an IoContext, so
 * it cannot reach a promise anchored in a dead one, which is exactly why the 4s abort
 * in `db.ts` never fired in three incidents. A plain timer is the only thing that
 * works here.
 *
 * And detecting it is only half the job: unless the poisoned instance is thrown away,
 * the next request hits the same dead promise. Clearing `_auth` makes the isolate
 * **self-heal** — one request pays 8s, the one after it rebuilds auth and succeeds,
 * instead of every request hanging until Cloudflare happens to evict the isolate.
 */
export async function callAuth<T>(
  label: string,
  call: (auth: ReturnType<typeof createAuth>) => Promise<T>,
): Promise<T> {
  try {
    return await withDeadline(call(getAuth()), AUTH_CALL_DEADLINE_MS, () => {
      const error = new Error(`auth ${label} stalled past ${AUTH_CALL_DEADLINE_MS}ms`)
      error.name = AUTH_STALLED
      return error
    })
  } catch (err) {
    if (isAuthStalled(err)) {
      // Throw the instance away rather than keep serving hangs from it.
      console.error(`[auth] ${label} stalled — discarding this isolate's auth instance`)
      _auth = undefined
    }
    throw err
  }
}

/**
 * Every origin BetterAuth will accept a signed-in POST from.
 *
 * The default list is `[baseURL]` and nothing else, which is exactly right in
 * production and a trap in development: `vite dev` asks for 5174, and if anything
 * already holds that port it moves to 5175 WITHOUT saying so. `BETTER_AUTH_URL` in
 * `.env` still names 5174, so every sign-in on the drifted port dies on `Invalid
 * origin` — an error about CSRF for what is actually a busy port. That happened on
 * 5 Sep 2026 with a day-old dev server still holding 5174.
 *
 * So a LOCAL baseURL — and only a local one — also trusts localhost on any port. A
 * deployed `BETTER_AUTH_URL` (`https://custodian.fund`) adds nothing: the wildcard
 * must never be reachable from a host a stranger can point at us.
 *
 * `vite.config.ts` sets `strictPort` so the drift stops happening at all; this is the
 * belt to that's braces, and it also covers `--port` and `pnpm preview`.
 */
function trustedOriginsFor(baseURL: string): string[] {
  const origins = [baseURL]
  const host = URL.canParse(baseURL) ? new URL(baseURL).hostname : ''
  if (host === 'localhost' || host === '127.0.0.1')
    origins.push('http://localhost:*', 'http://127.0.0.1:*')
  return origins
}

function createAuth() {
  const baseURL = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000'
  return betterAuth({
    secret: process.env['BETTER_AUTH_SECRET']!,
    baseURL,
    trustedOrigins: trustedOriginsFor(baseURL),
    onAPIError: {
      errorURL: '/sign-in',
    },
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    // Serve the session from a signed cookie instead of a database round trip.
    //
    // Off by default whenever a `database` is configured (`create-context.mjs:48` only
    // auto-enables it for DB-less setups), so until now EVERY session check — on every
    // server function, on every request — was a Neon query.
    //
    // **90s, not the library's default of 300.** The cost of caching a session is that
    // revoking it is not instant, so the window is the thing to argue about. 90s keeps
    // essentially all of the saving (a burst of navigation is a handful of seconds)
    // while keeping the stale window short enough to describe honestly.
    //
    // The exposure is narrower than it first looks, because `getAuthUser` makes TWO
    // trips and this only caches the first. Our own users+clients query is never
    // cached, so a role change, a tenant reassignment or a deleted user row is still
    // caught on the very next request. What this window does cover is BetterAuth's own
    // view of session validity — an explicitly revoked session, or a ban through the
    // admin plugin.
    //
    // Note there is currently no in-app way to remove a member or change a role, so
    // the obvious "sack someone and they keep access" case is not reachable today. If
    // one is added, revoke the session there rather than relying on this expiring, and
    // revisit this number.
    //
    // `refreshCache` is deliberately not set: it is meant for stateless setups and
    // better-auth logs a warning and disables it when a database is configured.
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 90,
      },
    },
    account: {
      accountLinking: {
        requireLocalEmailVerified: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      // To require email verification before sign-in, uncomment below and wire up Resend (or similar):
      // requireEmailVerification: true,
      // sendResetPassword: async ({ user, url }) => {
      //   await resend.emails.send({
      //     from: 'noreply@yourdomain.com',
      //     to: user.email,
      //     subject: 'Reset your password',
      //     html: `<a href="${url}">Reset password</a>`,
      //   })
      // },
    },
    // emailVerification: {
    //   sendOnSignUp: true,
    //   autoSignInAfterVerification: true,
    //   sendVerificationEmail: async ({ user, url }) => {
    //     await resend.emails.send({
    //       from: 'noreply@yourdomain.com',
    //       to: user.email,
    //       subject: 'Verify your email',
    //       html: `<a href="${url}">Verify email</a>`,
    //     })
    //   },
    // },
    socialProviders: {
      google: {
        clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
        clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
      },
    },
    plugins: [
      admin({
        ac,
        roles: { superadmin: superadminRole },
        // Only platform superadmins may use admin endpoints (e.g. impersonation).
        // Foundation `admin`s are tenant-scoped and must NOT get these powers.
        adminRoles: ['superadmin'],
        // Match our pgEnum — the plugin otherwise defaults new users to "user",
        // which is not a valid `user_role` value and would break signup inserts.
        // `trustee` is the least-privileged role; a signup without an invite has
        // no client_id anyway and is bounced to /no-access until one attaches.
        defaultRole: 'trustee',
      }),
      emailOTP({
        // Custodian is invitation-only. Without this the plugin signs up any
        // unknown email on the spot — and because `users.client_id` is nullable
        // that insert *succeeds*, minting a clientless `observer` with a live
        // session and no invitation. Unknown emails must fail instead.
        disableSignUp: true,
        otpLength: 6,
        expiresIn: 300,
        // A stolen code is a live credential until it expires, so cap guesses
        // and keep only a hash of it in `verifications`.
        allowedAttempts: 3,
        storeOTP: 'hashed',
        // These endpoints send mail to an attacker-chosen address, so they're the
        // one place an unauthenticated caller can make us emit email. Cap it.
        rateLimit: { window: 60, max: 3 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          // `forget-password` also covers "Google user who never had a password":
          // /email-otp/reset-password creates a `credential` account when the user
          // has none, which is the only way onto email+password for an OAuth-only
          // account. `email-verification` is unused — Google's is trusted and local
          // sign-up doesn't require it (see requireLocalEmailVerified).
          if (type === 'sign-in') await sendSignInCodeEmail({ to: email, otp })
          else if (type === 'forget-password') await sendPasswordResetCodeEmail({ to: email, otp })
        },
      }),
    ],
  })
}
