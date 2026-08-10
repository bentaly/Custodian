import { describe, it, expect, vi, beforeEach } from 'vitest'

// The wrapper captures `globalThis.fetch` when it installs, so the stub has to be in
// place first — and stay in place, since `vi.unstubAllGlobals()` would tear the
// installed wrapper out with it.
const original = vi.fn(async () => new Response('{}', { status: 200 }))
vi.stubGlobal('fetch', original)
vi.stubGlobal('location', {
  href: 'https://custodian.fund/programmes',
  origin: 'https://custodian.fund',
})

const { installRequestTimeout, longerTimeout, TIMEOUT_HEADER } = await import('./requestTimeout')
installRequestTimeout()
const send = globalThis.fetch

/** The signal the wrapper actually handed to the underlying fetch. */
const sentSignal = (): AbortSignal | null | undefined =>
  original.mock.calls.at(-1)?.[1 as never]?.['signal' as never]

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  original.mockClear()
})

describe('installRequestTimeout', () => {
  it('bounds a same-origin request', async () => {
    await send('/_serverFn/createProgramme', { method: 'POST', headers: longerTimeout(10) })

    const signal = sentSignal()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
    await settle(30)
    expect(signal!.aborted).toBe(true)
  })

  it('leaves other origins alone — their own client owns their deadlines', async () => {
    await send('https://api.charitycommission.gov.uk/register/api/charity/1', {
      headers: longerTimeout(10),
    })

    expect(sentSignal()).toBeUndefined()
  })

  it('races the caller signal rather than replacing it', async () => {
    // The router gives every loader an abort controller so a superseded navigation can
    // be cancelled. If the wrapper replaced that signal, navigation would stop
    // cancelling — a regression nobody would notice until the app felt slow.
    const navigation = new AbortController()
    await send('/_serverFn/listProgrammes', { signal: navigation.signal })

    const signal = sentSignal()
    expect(signal).not.toBe(navigation.signal)
    expect(signal!.aborted).toBe(false)

    navigation.abort()
    expect(signal!.aborted).toBe(true)
  })

  it('honours a longer deadline, whichever shape the headers arrive in', async () => {
    await send('/_serverFn/createAwards', { headers: longerTimeout(10) })
    await settle(30)
    expect(sentSignal()!.aborted).toBe(true)

    await send('/_serverFn/createAwards', { headers: new Headers({ [TIMEOUT_HEADER]: '10' }) })
    await settle(30)
    expect(sentSignal()!.aborted).toBe(true)

    await send(new Request('https://custodian.fund/_serverFn/x', { headers: longerTimeout(10) }))
    await settle(30)
    expect(sentSignal()!.aborted).toBe(true)
  })

  it('falls back to the default when the header is nonsense', async () => {
    await send('/_serverFn/x', { headers: { [TIMEOUT_HEADER]: 'soon' } })

    // Not aborted after a moment: it took the 15s default rather than treating NaN as 0
    // and cancelling the request instantly.
    await settle(30)
    expect(sentSignal()!.aborted).toBe(false)
  })

  it('installs once, however many times it is called', () => {
    const before = globalThis.fetch
    installRequestTimeout()
    installRequestTimeout()
    expect(globalThis.fetch).toBe(before)
  })
})
