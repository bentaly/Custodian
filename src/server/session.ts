import { forbidden, unauthorized } from '../lib/errors'
import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { getAuth } from './auth'
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

export async function getAuthUser() {
  const request = getRequest()
  let session: Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
  try {
    session = await getAuth().api.getSession({ headers: request.headers })
  } catch (err) {
    // Anything else here is BetterAuth rejecting the cookie — an expired or forged
    // session is genuinely "not signed in".
    rethrowIfDatabaseFault(err)
    return null
  }
  if (!session) return null

  try {
    const rows = await getDb()
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
      .where(eq(users.id, session.user.id))
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
