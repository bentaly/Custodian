import type { Context } from 'hono'
import type { Next } from 'hono'
import { verifyToken } from '@clerk/backend'
import { prisma } from '@custodian/db'

export async function clerkAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    c.set('user', null)
    return next()
  }

  try {
    const { sub: clerkId } = await verifyToken(token, {
      secretKey: process.env['CLERK_SECRET_KEY']!,
    })

    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, clerkId: true, email: true, role: true },
    })

    c.set('user', user)
  } catch {
    c.set('user', null)
  }

  return next()
}
