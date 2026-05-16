import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')(
  {
    server: {
      handlers: {
        GET: async ({ request }: { request: Request }) => {
          const { auth } = await import('../../server/auth')
          return auth.handler(request)
        },
        POST: async ({ request }: { request: Request }) => {
          const { auth } = await import('../../server/auth')
          return auth.handler(request)
        },
      },
    },
  } as any,
)
