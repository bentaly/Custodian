// Cloudflare Workers passes vars/secrets as `env` bindings to the fetch handler,
// but process.env (the Node.js compat polyfill) starts as a reference to the
// Workers' global process.env which doesn't include binding values.
// This thin wrapper copies all string bindings into process.env before
// delegating to the TanStack Start server, so server code using process.env works.
import handler from './dist/server/server.js'

export default {
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
    return handler.fetch(request, env, ctx)
  },
}
