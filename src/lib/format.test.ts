import { beforeAll, describe, expect, it } from 'vitest'
import { compactExact, fmtCompact, fmtDate, fmtDateTime, fmtPerYear, isoValue } from './format'

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

describe('fmtCompact', () => {
  it('keeps two significant figures in the thousands', () => {
    // The bug this pins: a £4,840 ask rendered "£5k" over its own subtext, "£2,420 per
    // year for 2 years" — arithmetic a reader could see did not add up, and £160 more
    // than the charity asked for.
    expect(fmtCompact(4840)).toBe('£4.8k')
    expect(fmtCompact(1050)).toBe('£1.1k')
    expect(fmtCompact(9900)).toBe('£9.9k')
  })

  it('drops a trailing .0, so a round figure stays round', () => {
    expect(fmtCompact(5000)).toBe('£5k')
    expect(fmtCompact(1000)).toBe('£1k')
    expect(fmtCompact(2_000_000)).toBe('£2m')
  })

  it('drops the decimal once the second figure is a whole unit', () => {
    expect(fmtCompact(45_300)).toBe('£45k')
    expect(fmtCompact(186_167)).toBe('£186k')
    expect(fmtCompact(12_400_000)).toBe('£12m')
  })

  it('never prints the unreal £1000k', () => {
    // 999,700 / 1000 rounds to 1000 in the thousands band, so the millions band has to
    // open below £1m rather than at it.
    expect(fmtCompact(999_700)).toBe('£1m')
    expect(fmtCompact(1_240_000)).toBe('£1.2m')
  })

  it('shows exact pounds below a thousand, and marks a negative', () => {
    expect(fmtCompact(950)).toBe('£950')
    expect(fmtCompact(0)).toBe('£0')
    expect(fmtCompact(-4840)).toBe('-£4.8k')
  })
})

describe('compactExact', () => {
  it('gives the exact figure when the compact one rounded something away', () => {
    expect(compactExact(4840)).toBe('£4,840')
    expect(compactExact(45_300)).toBe('£45,300')
    expect(compactExact(1_284_500)).toBe('£1,284,500')
  })

  it('is null when the compact form is only shorter, not vaguer', () => {
    // `£5k` IS £5,000. A tooltip repeating it is noise, and it would make the ones that
    // carry a different number indistinguishable.
    expect(compactExact(5000)).toBeNull()
    expect(compactExact(4_800)).toBeNull()
    expect(compactExact(2_000_000)).toBeNull()
    expect(compactExact(950)).toBeNull()
    expect(compactExact(0)).toBeNull()
  })

  it('follows the sign', () => {
    expect(compactExact(-4840)).toBe('-£4,840')
    expect(compactExact(-5000)).toBeNull()
  })
})

describe('fmtPerYear', () => {
  it('never multiplies back out to more than the ask', () => {
    // £35,000 over three years printed `£11,667`, and three of those is £35,001 —
    // an annual figure larger than the total stated directly above it.
    expect(fmtPerYear(35_000, 3)).toBe('£11,666.66 per year for 3 years')
    expect(fmtPerYear(10_000, 3)).toBe('£3,333.33 per year for 3 years')
  })

  it('keeps a clean division clean', () => {
    expect(fmtPerYear(4840, 2)).toBe('£2,420 per year for 2 years')
    expect(fmtPerYear(36_000, 3)).toBe('£12,000 per year for 3 years')
    // Exact in decimal, not in binary: this is what the epsilon in the floor protects.
    expect(fmtPerYear(3000, 3)).toBe('£1,000 per year for 3 years')
  })

  it('has nothing to say about a single year, an unset duration or no ask', () => {
    expect(fmtPerYear(35_000, 1)).toBeNull()
    expect(fmtPerYear(35_000, null)).toBeNull()
    expect(fmtPerYear(0, 3)).toBeNull()
  })
})
