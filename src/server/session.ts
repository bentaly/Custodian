import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { getAuth } from './auth'
import { getDb } from './db'
import { clients, users } from '../../drizzle/schema'

export async function getAuthUser() {
  const request = getRequest()
  let session: Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
  try {
    session = await getAuth().api.getSession({ headers: request.headers })
  } catch {
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
        role: users.role,
        clientId: users.clientId,
        clientName: clients.name,
      })
      .from(users)
      .leftJoin(clients, eq(users.clientId, clients.id))
      .where(eq(users.id, session.user.id))
    return rows[0] ?? null
  } catch {
    return null
  }
}

export async function requireAuthUser() {
  const user = await getAuthUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

export async function requireRole(
  ...roles: Array<'superadmin' | 'admin' | 'manager' | 'contributor' | 'observer' | 'trustee' | 'finance'>
) {
  const user = await requireAuthUser()
  if (!roles.includes(user.role)) throw new Error('Forbidden')
  return user
}
