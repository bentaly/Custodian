import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClerkProvider, useAuth } from '@clerk/react'
import { trpc, createTrpcClient } from './lib/trpc.js'
import { routeTree } from './routeTree.gen.js'
import './styles/globals.css'

const queryClient = new QueryClient()

function InnerApp() {
  const { getToken } = useAuth()
  const trpcClient = React.useMemo(() => createTrpcClient(getToken), [getToken])

  const router = React.useMemo(
    () =>
      createRouter({
        routeTree,
        context: { queryClient },
        defaultPreload: 'intent',
      }),
    [],
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  )
}

if (!import.meta.env['VITE_CLERK_PUBLISHABLE_KEY']) {
  throw new Error('Set VITE_CLERK_PUBLISHABLE_KEY in .env or .env.local')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      <InnerApp />
    </ClerkProvider>
  </React.StrictMode>,
)
