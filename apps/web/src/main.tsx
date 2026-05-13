import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
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

const publishableKey = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY']
if (!publishableKey) throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <InnerApp />
    </ClerkProvider>
  </React.StrictMode>,
)
