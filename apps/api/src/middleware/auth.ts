import type { Context, Next } from 'hono'
import { prisma } from '@custodian/db'
import { auth } from '../auth.js'

export async function authMiddleware(c: Context, next: Next) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, role: true },
    })
    c.set('user', user)
  } else {
    c.set('user', null)
  }

  return next()
}
