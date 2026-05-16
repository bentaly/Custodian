import { getRequest } from '@tanstack/react-start/server'
import { auth } from './auth'
import { prisma } from './db'

export async function getAuthUser() {
  const request = getRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null

  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true },
  })
}

export async function requireAuthUser() {
  const user = await getAuthUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

export async function requireAdmin() {
  const user = await requireAuthUser()
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    throw new Error('Forbidden')
  }
  return user
}
