import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')(
  {
    server: {
      handlers: {
        GET: async ({ request }: { request: Request }) => {
          const { getAuth } = await import('../../server/auth')
          return getAuth().handler(request)
        },
        POST: async ({ request }: { request: Request }) => {
          const { getAuth } = await import('../../server/auth')
          return getAuth().handler(request)
        },
      },
    },
  } as any,
)
