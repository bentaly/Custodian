import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@custodian/trpc/server'
import { prisma } from '@custodian/db'
import type { Context as HonoContext } from 'hono'

export function createTrpcHandler(c: HonoContext) {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({
      db: prisma,
      user: c.get('user') ?? null,
    }),
  })
}
