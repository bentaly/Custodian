import { describe, it, expect } from 'vitest'
import { DEFAULT_LANDING, oauthCallback, safeReturnPath, signInPath } from './signInRedirect'

describe('safeReturnPath', () => {
  it('keeps a path on this origin, including its query', () => {
    expect(safeReturnPath('/applications/2945bd25')).toBe('/applications/2945bd25')
    expect(safeReturnPath('/shortlist?round=abc')).toBe('/shortlist?round=abc')
  })

  it('refuses anything that could leave the origin', () => {
    // Both of these begin with a slash, and both resolve off-origin in a browser.
    expect(safeReturnPath('//evil.example')).toBeNull()
    expect(safeReturnPath('/\\evil.example')).toBeNull()
    expect(safeReturnPath('https://evil.example')).toBeNull()
    expect(safeReturnPath('javascript:alert(1)')).toBeNull()
    expect(safeReturnPath('applications')).toBeNull()
  })

  it('refuses a control character', () => {
    expect(safeReturnPath('/applications\n/x')).toBeNull()
    expect(safeReturnPath('/applications\u0000')).toBeNull()
  })

  it('refuses a return to an auth screen, which would loop', () => {
    expect(safeReturnPath('/sign-in')).toBeNull()
    expect(safeReturnPath('/sign-in?redirect=%2Fsign-in')).toBeNull()
    expect(safeReturnPath('/sign-up?invite=abc')).toBeNull()
  })

  it('refuses anything that is not a non-empty string', () => {
    expect(safeReturnPath('')).toBeNull()
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath(['/dashboard'])).toBeNull()
  })
})

describe('signInPath', () => {
  it('carries an encoded return path', () => {
    expect(signInPath('/applications/abc?tab=budget')).toBe(
      '/sign-in?redirect=%2Fapplications%2Fabc%3Ftab%3Dbudget',
    )
  })

  it('is the bare sign-in page when there is nowhere worth returning to', () => {
    expect(signInPath('/sign-in')).toBe('/sign-in')
    expect(signInPath('//evil.example')).toBe('/sign-in')
  })
})

describe('oauthCallback', () => {
  it('passes the ordinary paths this app actually produces', () => {
    expect(oauthCallback('/applications/2945bd25-c095-4d23', DEFAULT_LANDING)).toBe(
      '/applications/2945bd25-c095-4d23',
    )
    expect(oauthCallback('/shortlist?round=abc123', DEFAULT_LANDING)).toBe(
      '/shortlist?round=abc123',
    )
    expect(oauthCallback(signInPath('/awards/abc'), '/sign-in')).toBe(
      '/sign-in?redirect=%2Fawards%2Fabc',
    )
  })

  it('falls back rather than letting BetterAuth 403 the sign-in', () => {
    // `encodeURIComponent` leaves these alone, so they reach BetterAuth intact.
    expect(oauthCallback("/reports/o'brien", DEFAULT_LANDING)).toBe(DEFAULT_LANDING)
    expect(oauthCallback('/programmes/(draft)', DEFAULT_LANDING)).toBe(DEFAULT_LANDING)
    expect(oauthCallback('//evil.example', DEFAULT_LANDING)).toBe(DEFAULT_LANDING)
  })
})
