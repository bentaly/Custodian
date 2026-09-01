import { describe, it, expect } from 'vitest'
import {
  appErrorSerialization,
  forbidden,
  isAbort,
  isAppError,
  isNetworkError,
  messageFor,
  notFoundError,
  serverStackOf,
  statusOf,
} from './errors'
import type { WireAppError } from './errors'

/**
 * These predicates run on the *client*, against errors that have crossed serialisation
 * and lost their prototype. Every test therefore also asserts the "arrived over the
 * wire" shape, because that, not the class instance, is what the boundaries receive.
 *
 * It goes through `appErrorSerialization` rather than building the shape by hand. The
 * hand-built version was the reason the 25 Aug 2026 bug was invisible: it attached
 * `status` itself, so it tested the assumption that own properties survive rather than
 * what the serializer actually does with them. A helper that fabricates the wire
 * cannot fail when the wire changes.
 */
const asDeserialised = (err: Error & { status?: number }) =>
  appErrorSerialization.fromSerializable(appErrorSerialization.toSerializable(err as WireAppError))

describe('statusOf', () => {
  it('reads the status of an AppError', () => {
    expect(statusOf(forbidden())).toBe(403)
    expect(statusOf(notFoundError())).toBe(404)
  })

  it('reads the status after serialisation strips the prototype', () => {
    const wire = asDeserialised(forbidden())
    expect(wire instanceof Error).toBe(true)
    expect(statusOf(wire)).toBe(403)
  })

  it('treats anything untyped as a fault', () => {
    expect(statusOf(new Error('boom'))).toBe(500)
    expect(statusOf('a string')).toBe(500)
    expect(statusOf(null)).toBe(500)
    expect(statusOf(undefined)).toBe(500)
  })
})

describe('isAppError', () => {
  it('recognises the marker across the wire', () => {
    expect(isAppError(asDeserialised(notFoundError()))).toBe(true)
  })

  it('rejects a plain error', () => {
    expect(isAppError(new Error('boom'))).toBe(false)
    expect(isAppError(null)).toBe(false)
  })
})

describe('messageFor', () => {
  it('shows an AppError message verbatim — it is written for the user', () => {
    expect(messageFor(forbidden('That belongs to another foundation.'))).toBe(
      'That belongs to another foundation.',
    )
  })

  it('never shows a raw fault message, which could carry a query or a key', () => {
    expect(messageFor(new Error('relation "users" does not exist'))).not.toContain('relation')
  })
})

describe('serverStackOf', () => {
  it('returns null when the server sent no trace', () => {
    expect(serverStackOf(forbidden())).toBeNull()
    expect(serverStackOf(new Error('boom'))).toBeNull()
  })

  it('returns the trace the server chose to attach', () => {
    const withTrace = Object.assign(new Error('failed'), {
      status: 500,
      serverStack: 'Error: failed\n  at handler',
    })
    expect(serverStackOf(withTrace)).toContain('at handler')
  })

  it('treats an empty trace as absent', () => {
    expect(serverStackOf(Object.assign(new Error('x'), { serverStack: '' }))).toBeNull()
  })
})

describe('isAbort', () => {
  // A request that was cut short never rejects with anything the user could act on:
  // an AbortSignal.timeout gives a DOMException whose own text is "signal is aborted
  // without reason". This is the one failure the 9 Aug incident could NOT produce a
  // message for, because nothing threw at all until the deadline existed.
  it('recognises both a deadline and a cancellation', () => {
    expect(isAbort(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true)
    expect(isAbort(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true)
  })

  it('leaves ordinary failures alone', () => {
    expect(isAbort(new Error('boom'))).toBe(false)
    expect(isAbort(forbidden())).toBe(false)
    expect(isAbort(null)).toBe(false)
  })

  it('tells the user to look before acting again, rather than nothing at all', () => {
    const timedOut = Object.assign(new Error('signal is aborted without reason'), {
      name: 'TimeoutError',
    })
    expect(messageFor(timedOut)).toBe('Timed out — refresh to check whether this saved.')
  })
})

describe('isNetworkError', () => {
  const typeError = (message: string) => Object.assign(new Error(message), { name: 'TypeError' })

  it('recognises the same dropped connection in all three dialects', () => {
    expect(isNetworkError(typeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(typeError('Load failed'))).toBe(true)
    expect(isNetworkError(typeError('NetworkError when attempting to fetch resource.'))).toBe(true)
  })

  // The distinction the whole predicate exists for. Chrome words a missing chunk as a
  // longer sentence starting with the same four words, and that one is a stale deploy
  // recovered by `lib/staleChunk` — telling the user to check their wifi would send
  // them looking in the wrong place entirely.
  it('does NOT claim a chunk that went missing after a deploy', () => {
    expect(
      isNetworkError(
        typeError('Failed to fetch dynamically imported module: /assets/sign-in-A1.js'),
      ),
    ).toBe(false)
  })

  it('leaves ordinary failures alone', () => {
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(false)
    expect(isNetworkError(forbidden())).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })

  // Nothing on our side went wrong, nobody was alerted, and Sentry drops it — so the
  // generic "at our end… this has been reported" copy would be three lies at once.
  it('blames the connection rather than the server', () => {
    expect(messageFor(typeError('Failed to fetch'))).toBe(
      "Couldn't reach the server — check your connection and try again.",
    )
  })
})

describe('appErrorSerialization', () => {
  it('claims an AppError, so ShallowErrorPlugin never sees one', () => {
    expect(appErrorSerialization.test(forbidden())).toBe(true)
    expect(appErrorSerialization.test(new Error('boom'))).toBe(false)
    expect(appErrorSerialization.test({ status: 403 })).toBe(false)
  })

  it('carries status, message and the server trace across', () => {
    const sent = Object.assign(new Error('Nope.'), {
      status: 403,
      isAppError: true,
      serverStack: 'Error: Nope.\n    at handler',
    }) as WireAppError

    const received = appErrorSerialization.fromSerializable(
      appErrorSerialization.toSerializable(sent),
    )

    expect(statusOf(received)).toBe(403)
    expect(isAppError(received)).toBe(true)
    expect(messageFor(received)).toBe('Nope.')
    expect(serverStackOf(received)).toBe('Error: Nope.\n    at handler')
  })

  it('sends no stack of its own, and no trace the server withheld', () => {
    const received = appErrorSerialization.fromSerializable(
      appErrorSerialization.toSerializable(forbidden() as unknown as WireAppError),
    )
    expect(received.stack).toBe('')
    expect(serverStackOf(received)).toBeNull()
  })
})
