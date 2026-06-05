import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { users } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'

export const listClientUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []

  return getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.clientId, user.clientId))
    .orderBy(users.createdAt)
})
