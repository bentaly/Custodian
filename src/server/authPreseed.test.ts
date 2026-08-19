import { describe, it, expect } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'

// `worker-entry.js` prevents better-auth #10315 by constructing better-auth's three
// AsyncLocalStorage instances at isolate startup, so the library never takes its
// module-scope `import("node:async_hooks")` path — the promise that workerd abandons
// when the initialising request is aborted, poisoning auth for the whole isolate.
//
// That fix rests entirely on ONE undocumented internal behaviour: `ensureAsyncStorage`
// checks `globalThis[Symbol.for('better-auth:global')].context.*` first and returns
// early when it finds something. Nothing in better-auth's public API promises that. If
// an upgrade changes it, the pre-seed silently stops working and the 90-second hangs
// come back with no other signal — so the contract is pinned here rather than trusted.
//
// worker-entry.js is bundled by wrangler and cannot be imported by vitest, so this
// reproduces its pre-seed rather than importing it. Keep the two in step.

const BETTER_AUTH_GLOBAL = Symbol.for('better-auth:global')

describe('better-auth AsyncLocalStorage pre-seed', () => {
  it('short-circuits the lazy import when the global is already populated', async () => {
    const requestState = new AsyncLocalStorage()
    const endpointContext = new AsyncLocalStorage()
    const adapter = new AsyncLocalStorage()

    const holder = globalThis as Record<symbol, unknown>
    holder[BETTER_AUTH_GLOBAL] = {
      version: '1.6.25',
      epoch: 1,
      context: {
        requestStateAsyncStorage: requestState,
        endpointContextAsyncStorage: endpointContext,
        adapterAsyncStorage: adapter,
      },
    }

    // `@better-auth/core` is a transitive dependency, so resolve it the way
    // `better-auth` itself does rather than from our own source.
    const { createRequire } = await import('node:module')
    const fromHere = createRequire(import.meta.url)
    const fromBetterAuth = createRequire(fromHere.resolve('better-auth'))
    const { getRequestStateAsyncLocalStorage } = await import(
      fromBetterAuth.resolve('@better-auth/core/context')
    )

    // Identity, not just "resolves": getting a DIFFERENT instance back would mean the
    // library built its own through the path we are trying to avoid.
    expect(await getRequestStateAsyncLocalStorage()).toBe(requestState)
  })

  it('uses the three keys worker-entry.js seeds', async () => {
    // A rename upstream would leave the seed writing keys nobody reads.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('worker-entry.js', 'utf8'),
    )
    for (const key of [
      'requestStateAsyncStorage',
      'endpointContextAsyncStorage',
      'adapterAsyncStorage',
    ]) {
      expect(source).toContain(key)
    }
  })
})
