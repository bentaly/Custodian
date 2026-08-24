import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enqueue } from './pipelineQueue'

vi.mock('./faults', () => ({ reportFault: vi.fn(), captureFault: vi.fn() }))

const g = globalThis as { __cfEnv?: Record<string, unknown>; __cfCtx?: unknown }

describe('enqueue', () => {
  beforeEach(() => {
    delete g.__cfEnv
    delete g.__cfCtx
    vi.restoreAllMocks()
  })
  afterEach(() => {
    delete g.__cfEnv
    delete g.__cfCtx
  })

  it('runs the fallback in the background when no queue binding exists', async () => {
    // Local dev, and any deploy made before the queue is provisioned. Degrading to
    // the previous behaviour is what lets this ship ahead of the binding.
    const fallback = vi.fn(async () => 'done')
    const how = await enqueue({ kind: 'ingest', ingestId: 'i1' }, fallback)
    expect(how).toBe('background')
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('sends the message and does NOT run the fallback when the binding is present', async () => {
    const send = vi.fn(async () => {})
    g.__cfEnv = { PIPELINE_QUEUE: { send } }
    const fallback = vi.fn(async () => 'done')

    const how = await enqueue({ kind: 'score', applicationId: 'a1' }, fallback)

    expect(how).toBe('queued')
    expect(send).toHaveBeenCalledWith({ kind: 'score', applicationId: 'a1' })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not fall back to background work when the send fails', async () => {
    // The whole reason for the queue is that this work does not fit in the budget
    // `runInBackground` has (30s, then Cloudflare cancels it silently). Falling back
    // on a send failure would reproduce the exact outage the queue replaced, while
    // logging that the queue had been used.
    const send = vi.fn(async () => {
      throw new Error('queue unavailable')
    })
    g.__cfEnv = { PIPELINE_QUEUE: { send } }
    const fallback = vi.fn(async () => 'done')

    const how = await enqueue({ kind: 'ingest', ingestId: 'i2' }, fallback)

    expect(how).toBe('failed')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('reports a failed send, because it is the one gap a queue cannot cover itself', async () => {
    // A queue retries a message it has; it can never retry one it never received.
    const { reportFault } = await import('./faults')
    g.__cfEnv = {
      PIPELINE_QUEUE: {
        send: async () => {
          throw new Error('nope')
        },
      },
    }

    await enqueue({ kind: 'ingest', ingestId: 'i3' }, async () => {})

    expect(reportFault).toHaveBeenCalled()
  })

  it('ignores a binding that is not a queue', async () => {
    g.__cfEnv = { PIPELINE_QUEUE: 'not-a-queue' }
    const fallback = vi.fn(async () => {})
    expect(await enqueue({ kind: 'ingest', ingestId: 'i4' }, fallback)).toBe('background')
    expect(fallback).toHaveBeenCalled()
  })
})
