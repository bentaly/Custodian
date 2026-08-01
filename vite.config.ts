import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  // Source-map upload only happens where a token exists — i.e. in CI. A local
  // `pnpm build` has no token and simply skips it rather than failing.
  const sentryAuthToken = process.env['SENTRY_AUTH_TOKEN']

  return {
    server: {
      port: 5174,
      open: true,
    },
    build: {
      // Required for the upload below to have anything to send. Without maps, a
      // Worker stack trace is minified single-letter noise.
      sourcemap: true,
    },
    plugins: [
      // Tailwind v4's Vite plugin, not the PostCSS one: Vite's built-in
      // postcss-import runs first and tries to resolve `@import 'tailwindcss'`
      // as a file path, which fails the SSR build.
      tailwindcss(),
      tanstackStart(),
      viteReact(),
      // Must come last: it reads the finished bundle. Uploads maps to Sentry and then
      // deletes them, so they are never served from dist/client — Cloudflare publishes
      // that directory verbatim, and a stray .map there is the whole source tree.
      ...(sentryAuthToken
        ? [
            sentryVitePlugin({
              org: 'custodian-7o',
              project: 'node-cloudflare-workers',
              authToken: sentryAuthToken,
              // EU data region. The default points at the US instance, where this
              // org does not exist — the upload would 404.
              url: 'https://de.sentry.io',
              sourcemaps: {
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
            }),
          ]
        : []),
    ],
  }
})
