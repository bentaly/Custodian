import { createTRPCReact } from '@trpc/react-query'
import { httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@custodian/trpc'

export const trpc = createTRPCReact<AppRouter>()

export function createTrpcClient(getToken: () => Promise<string | null>) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001'}/trpc`,
        async headers() {
          const token = await getToken()
          return token ? { authorization: `Bearer ${token}` } : {}
        },
      }),
    ],
  })
}
