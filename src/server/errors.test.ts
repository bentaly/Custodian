import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notFound, redirect } from '@tanstack/react-router'

// `toClientError` is the app's redaction boundary: it decides what a caller is allowed
// to see when a server function throws. The rule it enforces — only platform
// superadmins receive a stack trace — is a security control, not a nicety, so it is
// pinned here. It also has to leave TanStack's control-flow throws alone, or every
// redirect in the app breaks.
const getAuthUser = vi.fn()

vi.mock('./session', () => ({ getAuthUser }))
vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }))

const { toClientError } = await import('./errors')
const { forbidden, notFoundError, conflict } = await import('../lib/errors')

const SUPERADMIN = { id: 'u1', role: 'superadmin', clientId: null }
const ADMIN = { id: 'u2', role: 'admin', clientId: 'c1' }

beforeEach(() => {
  getAuthUser.mockReset()
  getAuthUser.mockResolvedValue(ADMIN)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('control flow passes through untouched', () => {
  it('leaves redirect() alone', async () => {
    const thrown = redirect({ to: '/sign-in' })
    expect(await toClientError(thrown)).toBe(thrown)
  })

  it('leaves notFound() alone', async () => {
    const thrown = notFound()
    expect(await toClientError(thrown)).toBe(thrown)
  })
})

describe('expected 4xx errors keep their message', () => {
  it('preserves a 403 and its copy', async () => {
    const out = (await toClientError(forbidden('Not your foundation.'))) as Error & {
      status: number
    }
    expect(out.status).toBe(403)
    expect(out.message).toBe('Not your foundation.')
  })

  it('preserves a 404', async () => {
    const out = (await toClientError(notFoundError())) as Error & { status: number }
    expect(out.status).toBe(404)
  })

  it('preserves a 409 conflict message', async () => {
    const out = (await toClientError(conflict('Round has applications.'))) as Error & {
      status: number
    }
    expect(out.status).toBe(409)
    expect(out.message).toBe('Round has applications.')
  })

  it('never carries a stack, even for expected errors', async () => {
    const out = (await toClientError(forbidden())) as Error
    expect(out.stack).toBe('')
  })
})

describe('unexpected faults are redacted', () => {
  const fault = () => new Error('relation "users" does not exist')

  it('replaces the message for a non-superadmin', async () => {
    const out = (await toClientError(fault())) as Error & { status: number }
    expect(out.status).toBe(500)
    expect(out.message).not.toContain('relation')
    expect(out.message).toBe('Something went wrong at our end. Please try again.')
  })

  it('sends no stack to a non-superadmin', async () => {
    const out = (await toClientError(fault())) as Error & { serverStack?: string }
    expect(out.serverStack).toBeUndefined()
    expect(out.stack).toBe('')
  })

  it('sends the trace to a superadmin', async () => {
    getAuthUser.mockResolvedValue(SUPERADMIN)
    const out = (await toClientError(fault())) as Error & { serverStack?: string }
    expect(out.serverStack).toContain('relation "users" does not exist')
  })

  it('includes the cause chain for a superadmin', async () => {
    getAuthUser.mockResolvedValue(SUPERADMIN)
    const err = new Error('mapping failed', { cause: new Error('anthropic 429') })
    const out = (await toClientError(err)) as Error & { serverStack?: string }
    expect(out.serverStack).toContain('mapping failed')
    expect(out.serverStack).toContain('anthropic 429')
  })

  it('withholds the trace when the session lookup itself fails', async () => {
    // The database being down is exactly when errors happen and exactly when we
    // cannot prove who is asking — fail closed.
    getAuthUser.mockRejectedValue(new Error('db unreachable'))
    const out = (await toClientError(fault())) as Error & { serverStack?: string }
    expect(out.serverStack).toBeUndefined()
  })

  it('withholds the trace from an anonymous caller', async () => {
    getAuthUser.mockResolvedValue(null)
    const out = (await toClientError(fault())) as Error & { serverStack?: string }
    expect(out.serverStack).toBeUndefined()
  })
})
