import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { users } from '../../drizzle/schema'

export async function getAuthUser() {
  const request = getRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      foundationId: users.foundationId,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
  return rows[0] ?? null
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
