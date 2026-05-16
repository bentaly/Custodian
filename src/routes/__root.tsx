import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000 },
  },
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Custodian' },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex h-screen items-center justify-center">
      <p className="text-sm text-gray-500">Page not found.</p>
    </div>
  ),
  component: Root,
})

function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
