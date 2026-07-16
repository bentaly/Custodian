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
