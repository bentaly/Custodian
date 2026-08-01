import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ErrorState } from '../components/ui/ErrorState'
import { notFoundError } from '../lib/errors'
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
    links: [
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        // `opsz` is Inter's optical-size axis: 14 is the Text cut, 32 is Inter Display.
        // Requesting the full range lets one file serve body copy and headings; the
        // browser interpolates by size (font-optical-sizing: auto), and `.font-display`
        // pins opsz 32 where the design calls for Display explicitly.
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap',
      },
    ],
  }),
  // Last resort. A URL matching no route at all lands here; anything inside the app
  // is caught by `_authenticated` first and keeps the sidebar and header.
  notFoundComponent: () => (
    <Shell>
      <div className="flex min-h-screen items-center justify-center p-6">
        <ErrorState error={notFoundError('That page does not exist.')} />
      </div>
    </Shell>
  ),
  errorComponent: ({ error, reset }) => (
    <Shell>
      <div className="flex min-h-screen items-center justify-center p-6">
        <ErrorState error={error} onRetry={reset} />
      </div>
    </Shell>
  ),
  component: Root,
})

/**
 * The document itself.
 *
 * Both boundaries above render this rather than bare markup, because a root
 * `errorComponent` replaces the root *component* — it is not nested inside it. Return
 * only a `<div>` and the page ships with no `<head>`, no stylesheet and no `<Scripts>`,
 * which is why an unstyled wall of text is the classic look of a root-level crash.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>{children}</body>
    </html>
  )
}

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
