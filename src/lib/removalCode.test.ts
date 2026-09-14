import { describe, expect, it } from 'vitest'
import {
  REMOVAL_CODE_ATTEMPTS,
  generateRemovalCode,
  hashRemovalCode,
  judgeRemovalCode,
  removalCodeValue,
} from './removalCode'

const NOW = new Date('2026-09-13T12:00:00Z')
const LATER = new Date('2026-09-13T12:04:00Z')

describe('judgeRemovalCode', () => {
  it('accepts the right code in time', async () => {
    const hash = await hashRemovalCode('u1', '123456')
    expect(
      judgeRemovalCode({
        stored: { value: removalCodeValue(hash, 0), expiresAt: LATER },
        submittedHash: hash,
        now: NOW,
      }),
    ).toEqual({ ok: true })
  })

  it('charges an attempt for a wrong code', async () => {
    const hash = await hashRemovalCode('u1', '123456')
    const verdict = judgeRemovalCode({
      stored: { value: removalCodeValue(hash, 1), expiresAt: LATER },
      submittedHash: await hashRemovalCode('u1', '654321'),
      now: NOW,
    })
    expect(verdict).toEqual({ ok: false, reason: 'wrong', nextValue: removalCodeValue(hash, 2) })
  })

  it('stops accepting anything once the attempts are spent, the right code included', async () => {
    const hash = await hashRemovalCode('u1', '123456')
    expect(
      judgeRemovalCode({
        stored: { value: removalCodeValue(hash, REMOVAL_CODE_ATTEMPTS), expiresAt: LATER },
        submittedHash: hash,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'too_many', discard: true })
  })

  it('refuses an expired code', async () => {
    const hash = await hashRemovalCode('u1', '123456')
    expect(
      judgeRemovalCode({
        stored: { value: removalCodeValue(hash, 0), expiresAt: NOW },
        submittedHash: hash,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'expired', discard: true })
  })

  it('says so when no code was ever sent', () => {
    expect(judgeRemovalCode({ stored: null, submittedHash: 'x', now: NOW })).toEqual({
      ok: false,
      reason: 'missing',
    })
  })
})

describe('hashRemovalCode', () => {
  it('hashes the same digits differently for different people', async () => {
    expect(await hashRemovalCode('u1', '123456')).not.toBe(await hashRemovalCode('u2', '123456'))
  })
})

describe('generateRemovalCode', () => {
  it('is always six digits, leading zeros kept', () => {
    for (let i = 0; i < 200; i++) expect(generateRemovalCode()).toMatch(/^\d{6}$/)
  })
})
