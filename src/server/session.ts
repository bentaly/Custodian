import { forbidden, unauthorized } from '../lib/errors'
import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { callAuth, type AuthInstance } from './auth'
import { databaseTimeout, getDb } from './db'
import { clients, users } from '../../drizzle/schema'

/**
 * A failure that means "we could not tell", not "you are not signed in".
 *
 * The distinction is load-bearing. Both `catch`es below used to swallow everything and
 * return `null`, which reads identically to a signed-out visitor — so a database that
 * did not answer sent the caller to `/sign-in`, and because redirects are deliberately
 * filtered out of Sentry as router control flow (`isRouterControlFlow`), nothing
 * anywhere recorded that it had happened. A user got logged out because Neon was slow
 * and we had no way to know.
 *
 * Rethrowing hands the error to `toClientError`, which already has the right 503 and
 * the right copy for it.
 */
function rethrowIfDatabaseFault(err: unknown): void {
  if (databaseTimeout(err)) throw err
}

/**
 * Tells the two halves of this function apart in the logs.
 *
 * Worth the line because on 18 Aug 2026 the hang was provably NOT the database in
 * general: while `getMe` sat past 20s on custodian.fund, the admin app's polling hit
 * `/api/admin/ingests` — same Worker, same seconds — and got 200s in 17-300ms, and
 * Neon's compute was awake throughout. What the hanging requests had in common was the
 * session lookup; the healthy ones never touch it. This says which half was waiting.
 */
const SLOW_SESSION_MS = 1_000

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  try {
    return await work()
  } finally {
    const elapsed = Date.now() - startedAt
    if (elapsed >= SLOW_SESSION_MS) console.warn(`[session] ${label} ${elapsed}ms`)
  }
}

/**
 * How long an impersonation session is allowed to live, enforced here because
 * BetterAuth does not actually enforce its own.
 *
 * The admin plugin creates an impersonation session with `expiresAt = now + 1 hour`
 * (`plugins/admin/routes.mjs:596`). But its "should I extend this session?" test is
 *
 *     expiresAt - expiresIn(7d) + updateAge(1d) <= now
 *
 * (`api/routes/session.mjs:207`), which assumes every session started life at the full
 * `expiresIn`. For a one-hour session that expression is **always true**, so every
 * request takes the refresh branch and rewrites `expiresAt` to `now + 7 days`. The cap
 * therefore never binds: impersonation lasts a week and renews on every request for as
 * long as it is used.
 *
 * The library's own switches (`disableSessionRefresh`, `deferSessionRefresh`) would fix
 * it only by changing when ORDINARY users get signed out, which is a much bigger blast
 * radius than the problem. Enforcing the cap ourselves touches nothing else: an
 * impersonation session is created fresh when impersonation starts, so `createdAt` is
 * the moment it began, and a normal session has no `impersonatedBy` at all and never
 * reaches this check.
 */
const IMPERSONATION_MAX_MS = 60 * 60 * 1000

/** BetterAuth may hand this back as a `Date` or as a string, depending on adapter. */
function startedAt(value: unknown): number | null {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

/**
 * An impersonation session past its hour. Treated as not signed in — the superadmin
 * signs in again as themselves, which is what a one-hour cap means.
 *
 * Fails OPEN on an unreadable `createdAt`: refusing every impersonation session because
 * a timestamp did not parse would break the feature outright, and the row is ours.
 */
function impersonationExpired(session: { impersonatedBy?: unknown; createdAt?: unknown }): boolean {
  if (!session.impersonatedBy) return false
  const began = startedAt(session.createdAt)
  if (began === null) return false
  return Date.now() - began > IMPERSONATION_MAX_MS
}

export async function getAuthUser() {
  const request = getRequest()
  let session: Awaited<ReturnType<AuthInstance['api']['getSession']>>
  try {
    session = await timed('betterauth', () =>
      callAuth('getSession', (auth) => auth.api.getSession({ headers: request.headers })),
    )
  } catch (err) {
    // Anything else here is BetterAuth rejecting the cookie — an expired or forged
    // session is genuinely "not signed in".
    rethrowIfDatabaseFault(err)
    return null
  }
  if (!session) return null

  if (impersonationExpired(session.session)) {
    console.warn('[session] impersonation past its hour — treating as signed out')
    return null
  }

  try {
    const rows = await timed('user+client', () =>
      getDb()
        .select({
          id: users.id,
          email: users.email,
          // Whether the address was *proven* (Google, or an emailed invite token) rather
          // than merely typed. `claimPendingInvite` gates tenant attachment on this.
          emailVerified: users.emailVerified,
          name: users.name,
          // Avatar. Populated by Google OAuth on sign-up; falls back to initials in the UI.
          image: users.image,
          role: users.role,
          clientId: users.clientId,
          clientName: clients.name,
        })
        .from(users)
        .leftJoin(clients, eq(users.clientId, clients.id))
        .where(eq(users.id, session.user.id)),
    )
    return rows[0] ?? null
  } catch (err) {
    rethrowIfDatabaseFault(err)
    return null
  }
}

export async function requireAuthUser() {
  const user = await getAuthUser()
  if (!user) throw unauthorized()
  return user
}

export type UserRole = 'superadmin' | 'admin' | 'trustee' | 'finance'

export async function requireRole(...roles: UserRole[]) {
  const user = await requireAuthUser()
  if (!roles.includes(user.role)) throw forbidden()
  return user
}

/** Exposed for `impersonation.test.ts`; not part of the module's real surface. */
export const __testing = { impersonationExpired, IMPERSONATION_MAX_MS }
