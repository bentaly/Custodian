import { router } from './init.js'
import { healthRouter } from './routers/health.js'
import { applicationsRouter } from './routers/applications.js'
import { fundsRouter } from './routers/funds.js'
import { organisationsRouter } from './routers/organisations.js'

export const appRouter = router({
  health: healthRouter,
  applications: applicationsRouter,
  funds: fundsRouter,
  organisations: organisationsRouter,
})

export type AppRouter = typeof appRouter
