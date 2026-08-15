import { beforeAll, describe, expect, it } from 'vitest'
import { fmtDate, fmtDateTime, isoValue } from './format'

/**
 * These run in NEW YORK, and that is the whole point.
 *
 * Both date bugs this file pins were invisible from London: a calendar date rendered a
 * day EARLY anywhere west of UTC, and an evening timestamp rendered a day LATE during
 * British Summer Time. A suite that runs in the author's timezone cannot see either, so
 * this one moves.
 */
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})

describe('fmtDate', () => {
  it('shows a calendar date as the day it says, west of UTC', () => {
    // An instalment due on the 31st is due on the 31st in every timezone: the column is
    // `text`, holds no time, and means a day on a calendar. Parsed naively this read
    // "30 Aug" for every American user.
    expect(fmtDate('2026-08-31')).toBe('31 Aug 2026')
  })

  it('shows an instant on its UTC day, not the reader’s', () => {
    // 23:15 UTC is the next day in BST and the same day in New York. Neither should
    // change what the app calls the date, and the UTC day is what the CSV exports and
    // the server’s own `to_char` already use.
    expect(fmtDate('2026-08-31T23:15:37Z')).toBe('31 Aug 2026')
    expect(fmtDate('2026-08-31T00:30:00Z')).toBe('31 Aug 2026')
  })

  it('accepts a Date as well as a string', () => {
    expect(fmtDate(new Date('2026-03-05T12:00:00Z'))).toBe('5 Mar 2026')
  })

  it('is an em dash when there is nothing to show', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate(undefined)).toBe('—')
    expect(fmtDate('')).toBe('—')
  })
})

describe('fmtDateTime', () => {
  it('gives the long form with the time, in UTC', () => {
    expect(fmtDateTime('2026-08-31T23:15:37Z')).toBe('31 August 2026 at 23:15 UTC')
  })

  it('is null for a calendar date — there is no time to reveal', () => {
    // A tooltip reading "00:00" would be claiming precision the column has not got.
    expect(fmtDateTime('2026-08-31')).toBeNull()
    expect(fmtDateTime(null)).toBeNull()
  })
})

describe('isoValue', () => {
  it('keeps a calendar date as the day, and an instant as the instant', () => {
    expect(isoValue('2026-08-31')).toBe('2026-08-31')
    expect(isoValue('2026-08-31T23:15:37Z')).toBe('2026-08-31T23:15:37.000Z')
  })
})
