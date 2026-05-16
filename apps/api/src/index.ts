import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authMiddleware } from './middleware/auth.js'
import { createTrpcHandler } from './trpc.js'
import { auth } from './auth.js'

const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
  }),
)

app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))

app.use('*', authMiddleware)

app.get('/healthz', (c) => c.json({ ok: true }))
app.all('/trpc/*', (c) => createTrpcHandler(c))

const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, () => {
  console.log(`API running on http://localhost:${port}`)
})

export type { AppRouter } from '@custodian/trpc'
