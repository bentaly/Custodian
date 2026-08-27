// Cloudflare Workers passes vars/secrets as `env` bindings to the fetch handler,
// but process.env (the Node.js compat polyfill) starts as a reference to the
// Workers' global process.env which doesn't include binding values.
// This thin wrapper copies all string bindings into process.env before
// delegating to the TanStack Start server, so server code using process.env works.
import { AsyncLocalStorage } from 'node:async_hooks'
import * as Sentry from '@sentry/cloudflare'
import handler from './dist/server/server.js'

// ─── Pre-seed better-auth's AsyncLocalStorage (prevents the isolate-hang) ─────
//
// This is the fix for better-auth #10315, which caused three production hangs
// (9, 17 and 18 Aug 2026) of 45-90 seconds each.
//
// The bug: `@better-auth/core/async_hooks` holds a MODULE-SCOPE
// `import("node:async_hooks")` promise, and on the `workerd` export condition that
// lazy path is the one taken. Because our route does `await import('./server/auth')`
// and vite code-splits better-auth into its own chunk, that promise is first created
// *inside whatever request happens to touch auth first on a cold isolate*. In workerd a
// promise created while handling a request belongs to that request's IoContext — and
// when the client disconnects, workerd ABANDONS pending promises rather than rejecting
// them. They never settle and nothing throws. The result is cached in three places, so
// one interrupted request poisons every auth call for the isolate's remaining life.
//
// The fix works because `ensureAsyncStorage` (core/dist/context/request-state.mjs)
// checks `betterAuthGlobal.context.*AsyncStorage` FIRST and returns early when set. By
// constructing them here — from a STATIC import, at module scope, evaluated at isolate
// startup rather than inside any request — the dynamic-import path is never taken and
// there is no request-scoped promise to poison.
//
// It must live in this file. `src/server/auth.ts` cannot do it: that module is itself
// dynamically imported per request, which is the very problem.
//
// `src/server/auth.ts`'s `callAuth` watchdog stays as the belt to this braces — it
// covers the second cached promise (better-auth's own `$context`) and lets a poisoned
// isolate heal if any path we have not thought of still manages to stall.
const BETTER_AUTH_GLOBAL = Symbol.for('better-auth:global')
const betterAuthGlobal = (globalThis[BETTER_AUTH_GLOBAL] ??= {
  // Kept in step with the installed better-auth only to avoid a needless epoch bump;
  // if it drifts, `__getBetterAuthGlobal` corrects the version and preserves `context`,
  // so a stale string here is harmless rather than a landmine.
  version: '1.6.25',
  epoch: 1,
  context: {},
})
betterAuthGlobal.context ??= {}
betterAuthGlobal.context.requestStateAsyncStorage ??= new AsyncLocalStorage()
betterAuthGlobal.context.endpointContextAsyncStorage ??= new AsyncLocalStorage()
betterAuthGlobal.context.adapterAsyncStorage ??= new AsyncLocalStorage()

// The DSN is not a secret (see src/lib/sentry.ts for why it is committed). It is
// duplicated here rather than imported because this file is bundled by wrangler, not
// vite — it cannot reach into the TypeScript sources under src/.
const SENTRY_DSN =
  'https://99a1bb7960228a135ed95825e59e6297@o4511832040079360.ingest.de.sentry.io/4511832062820432'

/**
 * Copy the Worker's bindings into the places server code looks for them.
 *
 * This MUST run at the top of every entry point, not just `fetch`. It lived inline in
 * the fetch handler until the Cron Trigger arrived, and a `scheduled` invocation does
 * not go through `fetch` — so without this being shared, the weekly run would wake up
 * with no DATABASE_URL and no RESEND_API_KEY and fail quietly every Monday.
 */
function bridgeEnv(env, ctx) {
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
}


// ─── Security headers ────────────────────────────────────────────────────────
//
// The app shipped with none of these — verified against production on 2026-08-27,
// where `curl -I https://custodian.fund/sign-in` returned nothing but `content-type`.
//
// Applied here rather than in the app because this wrapper sees EVERY response:
// server-rendered pages, server functions, the public API routes and the static
// assets alike. A header set in one framework layer inevitably misses another, and
// the miss is silent.
//
// What is deliberately NOT here is a `script-src` CSP. A real one on this app needs
// nonces threaded through TanStack's hydration, and a CSP that breaks the page gets
// switched off rather than fixed. The three directives below are the ones that cost
// nothing to be right about: no page may frame us, no plugin content, and no injected
// `<base>` can repoint every relative URL on the page.
const SECURITY_HEADERS = {
  // Clickjacking. This app has one-click destructive actions behind a session —
  // approve a grant, mark an instalment paid — which is exactly what framing exploits.
  // `frame-ancestors` is the modern control; X-Frame-Options covers older browsers
  // that ignore it.
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'X-Frame-Options': 'DENY',
  // Stop a browser second-guessing a Content-Type — the reason `/api/avatar` can serve
  // user-uploaded bytes without one of them being sniffed into something executable.
  'X-Content-Type-Options': 'nosniff',
  // Application URLs carry record UUIDs. Send the origin, never the path, off-site.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Nothing here uses any of them; saying so stops an injected iframe asking on our
  // behalf and makes the permission prompt itself impossible.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // A year, apex only. `includeSubDomains` is deliberately absent: it would bind every
  // present and future subdomain of custodian.fund to HTTPS in browsers that have seen
  // this header, which is not a promise to make on the way past. Same for `preload`,
  // which is effectively irreversible.
  'Strict-Transport-Security': 'max-age=31536000',
}

/**
 * Copy the headers onto a response without disturbing what is already there.
 *
 * Never overwrites: the admin endpoints set their own CORS headers and `/api/avatar`
 * sets its own long-lived `Cache-Control`, and a blanket header pass that clobbered
 * either would be a bug introduced by a security fix.
 */
function withSecurityHeaders(response) {
  // 101 has no headers to rewrite and cloning it throws.
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const worker = {
  async fetch(request, env, ctx) {
    bridgeEnv(env, ctx)
    return withSecurityHeaders(await handler.fetch(request, env, ctx))
  },

  /**
   * Queue messages land here (`[[queues.consumers]]` in wrangler.toml).
   *
   * This is where the ingest pipeline runs now. It used to run under
   * `ctx.waitUntil` on the submission's own request, which Cloudflare cancels 30
   * seconds after the response — on 24 Aug 2026 it did exactly that, mid-way through
   * a Custodian score, and because a cancelled waitUntil promise is abandoned rather
   * than rejected the failure was completely silent. A queue consumer gets 15
   * minutes, retries with backoff, and a dead-letter queue for what still fails.
   *
   * Like `scheduled`, it reaches the app through `handler.fetch` with a synthetic
   * Request, because this file is bundled by wrangler and cannot see `src/`. That
   * call is in-process — no network hop, no subrequest.
   *
   * Each message is acked or retried on its own. A batch is not all-or-nothing:
   * `retryAll()` on one bad message would re-run the good ones too, and re-running a
   * pipeline that already promoted an application is the duplicate we just went to
   * some trouble to make impossible.
   */
  async queue(batch, env, ctx) {
    bridgeEnv(env, ctx)

    if (!env.CRON_SECRET) {
      // The endpoint fails closed, so every message would 401 and then dead-letter.
      // Retry instead: the secret can be set without losing the work.
      console.error('[queue] CRON_SECRET is not set — cannot dispatch pipeline work')
      batch.retryAll()
      return
    }

    const origin = (env.BETTER_AUTH_URL || 'https://custodian.fund').replace(/\/+$/, '')

    for (const message of batch.messages) {
      const started = Date.now()
      const describe = `${message.body?.kind ?? 'unknown'} (attempt ${message.attempts})`
      try {
        const response = await handler.fetch(
          new Request(`${origin}/api/internal/pipeline`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${env.CRON_SECRET}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(message.body),
          }),
          env,
          ctx,
        )
        if (response.ok) {
          console.log(`[queue] ${describe} ok in ${Date.now() - started}ms`)
          message.ack()
        } else {
          const body = await response.text()
          console.error(
            `[queue] ${describe} → ${response.status} in ${Date.now() - started}ms: ${body.slice(0, 500)}`,
          )
          message.retry()
        }
      } catch (err) {
        console.error(`[queue] ${describe} threw after ${Date.now() - started}ms:`, err)
        message.retry()
      }
    }
  },

  /**
   * Cron Triggers land here (`[triggers]` in wrangler.toml). Today that is only the
   * weekly payments digest, Mondays at 08:00 UTC.
   *
   * It reaches the app by calling `handler.fetch` with a synthetic Request rather than
   * importing the digest code, because this file is bundled by wrangler and cannot see
   * anything under `src/`. That call is in-process — no network hop, no subrequest — and
   * it means the scheduled path and the manual `curl` path are the same code.
   *
   * Everything here is logged rather than thrown. A cron has no caller to return an
   * error to, so Workers Logs is the only record that Monday happened at all.
   */
  async scheduled(event, env, ctx) {
    bridgeEnv(env, ctx)

    if (!env.CRON_SECRET) {
      // The endpoint fails closed on a missing secret, so this would be a silent 401
      // every week. Say so loudly instead — this is the one failure nobody would notice.
      console.error('[cron] CRON_SECRET is not set — the digest endpoint will refuse the call')
      return
    }

    const origin = (env.BETTER_AUTH_URL || 'https://custodian.fund').replace(/\/+$/, '')
    const started = Date.now()
    try {
      const response = await handler.fetch(
        new Request(`${origin}/api/cron/finance-digest`, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.CRON_SECRET}` },
        }),
        env,
        ctx,
      )
      const body = await response.text()
      console.log(
        `[cron] ${event.cron} → ${response.status} in ${Date.now() - started}ms: ${body.slice(0, 2000)}`,
      )
    } catch (err) {
      console.error(`[cron] ${event.cron} threw after ${Date.now() - started}ms:`, err)
    }
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
