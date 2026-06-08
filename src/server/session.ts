import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { getAuth } from './auth'
import { getDb } from './db'
import { users } from '../../drizzle/schema'

export async function getAuthUser() {
  const request = getRequest()
  let session: Awaited<ReturnType<typeof getAuth>['api']['getSession']>
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
        name: users.name,
        role: users.role,
        clientId: users.clientId,
      })
      .from(users)
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
  ...roles: Array<'superadmin' | 'admin' | 'manager' | 'contributor' | 'observer' | 'trustee'>
) {
  const user = await requireAuthUser()
  if (!roles.includes(user.role)) throw new Error('Forbidden')
  return user
}
