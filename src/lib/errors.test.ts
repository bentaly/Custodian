import { describe, it, expect } from 'vitest'
import {
  forbidden,
  isAppError,
  messageFor,
  notFoundError,
  serverStackOf,
  statusOf,
} from './errors'

/**
 * These predicates run on the *client*, against errors that have crossed seroval
 * serialisation and lost their prototype. Every test therefore also asserts the
 * "arrived over the wire" shape — a plain object with our own properties attached —
 * because that, not the class instance, is what the boundaries actually receive.
 */
const asDeserialised = (err: Error & { status?: number }) =>
  Object.assign(new Error(err.message), {
    status: err.status,
    isAppError: true,
  })

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
    expect(messageFor(new Error('relation "users" does not exist'))).not.toContain(
      'relation',
    )
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
