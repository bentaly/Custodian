// Cloudflare Workers passes vars/secrets as `env` bindings to the fetch handler,
// but process.env (the Node.js compat polyfill) starts as a reference to the
// Workers' global process.env which doesn't include binding values.
// This thin wrapper copies all string bindings into process.env before
// delegating to the TanStack Start server, so server code using process.env works.
import * as Sentry from '@sentry/cloudflare'
import handler from './dist/server/server.js'

// The DSN is not a secret (see src/lib/sentry.ts for why it is committed). It is
// duplicated here rather than imported because this file is bundled by wrangler, not
// vite — it cannot reach into the TypeScript sources under src/.
const SENTRY_DSN =
  'https://99a1bb7960228a135ed95825e59e6297@o4511832040079360.ingest.de.sentry.io/4511832062820432'

const worker = {
  async fetch(request, env, ctx) {
    if (env && typeof env === 'object') {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string') {
          globalThis.process ??= { env: {} }
          globalThis.process.env ??= {}
          globalThis.process.env[key] = value
        }
      }
    }
    // Non-string bindings (rate limiters, KV, etc.) can't go through process.env,
    // so stash the live env for server code that needs them (see src/server/rateLimit.ts).
    globalThis.__cfEnv = env
    // Execution context, for post-response work via ctx.waitUntil (see
    // src/server/background.ts). Like __cfEnv this is overwritten per request;
    // registering on a concurrent request's ctx still keeps the work alive.
    globalThis.__cfCtx = ctx
    return handler.fetch(request, env, ctx)
  },
}

// `withSentry` owns the outermost layer so it sees anything the app throws before the
// runtime turns it into a bare 500, and so it can flush events via ctx.waitUntil —
// without that flush a Worker isolate is torn down before the event is sent.
//
// This catches *uncaught* request errors only. Server-function errors never reach
// here: TanStack catches them and serialises them back to the caller, so those are
// reported explicitly from the server error middleware instead.
export default Sentry.withSentry(
  (env) => ({
    // An empty DSN disables the SDK outright. `wrangler dev` locally sets no
    // SENTRY_ENVIRONMENT, so local Worker runs stay out of the issue stream — matching
    // the browser, which skips localhost (see src/lib/sentry.ts `shouldReport`).
    dsn: env.SENTRY_ENVIRONMENT ? SENTRY_DSN : '',
    // Set per-Worker in wrangler.toml — both Workers are built from the same commit,
    // so the build itself cannot tell staging from prod.
    environment: env.SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: 0,
    // Which outbound requests may carry `sentry-trace` / `baggage` headers. The SDK
    // enables its Fetch integration by default and, left unset, this defaults to
    // *everything* — so our Neon queries, Charity Commission and Companies House
    // lookups, postcodes.io, Anthropic and Resend calls were all being stamped with
    // tracing headers none of them asked for. Restrict it to our own hosts.
    tracePropagationTargets: [
      /^https:\/\/custodian\.fund/,
      /^https:\/\/custodian(-staging)?\.bental\.workers\.dev/,
      /^\//,
    ],
    sendDefaultPii: false,
    // Browser and Worker errors share one Sentry project — tag which half threw.
    initialScope: { tags: { side: 'worker' } },
  }),
  worker,
)
