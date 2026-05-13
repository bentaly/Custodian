import { publicProcedure, router } from '../init.js'

export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    ok: true,
    timestamp: new Date().toISOString(),
  })),
})
