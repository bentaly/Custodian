import { describe, expect, it } from 'vitest'
import {
  arrivalPhrase,
  averageAlignment,
  inScheduleFilter,
  letterPhrase,
  nextPaymentPill,
} from './awardScreen'

describe('inScheduleFilter', () => {
  it('keeps the award out of both narrowed views', () => {
    expect(inScheduleFilter('awarded', 'all')).toBe(true)
    expect(inScheduleFilter('awarded', 'payments')).toBe(false)
    expect(inScheduleFilter('awarded', 'reports')).toBe(false)
  })

  it('splits money from reporting', () => {
    expect(inScheduleFilter('instalment', 'payments')).toBe(true)
    expect(inScheduleFilter('instalment', 'reports')).toBe(false)
    expect(inScheduleFilter('report', 'reports')).toBe(true)
    expect(inScheduleFilter('report', 'payments')).toBe(false)
  })
})

describe('nextPaymentPill', () => {
  const today = '2026-09-11'

  it('says nothing for a grant with no schedule', () => {
    expect(nextPaymentPill(null, false, today)).toBeNull()
  })

  it('says paid in full once nothing is left', () => {
    expect(nextPaymentPill(null, true, today)).toEqual({ text: 'Paid in full', tone: 'success' })
  })

  it('counts the days to the next payment', () => {
    expect(nextPaymentPill({ dueDate: '2026-09-22' }, true, today)?.text).toBe(
      'Next payment in 11 days',
    )
    expect(nextPaymentPill({ dueDate: '2026-09-12' }, true, today)?.text).toBe(
      'Next payment due tomorrow',
    )
    expect(nextPaymentPill({ dueDate: today }, true, today)?.text).toBe('Next payment due today')
  })

  it('turns red once the date has passed', () => {
    expect(nextPaymentPill({ dueDate: '2026-09-10' }, true, today)).toEqual({
      text: 'Payment overdue by 1 day',
      tone: 'danger',
    })
  })

  it('has no count for an undated instalment', () => {
    expect(nextPaymentPill({ dueDate: null }, true, today)?.text).toBe(
      'Next payment date to be confirmed',
    )
  })
})

describe('arrivalPhrase', () => {
  it('reads early, on time and late', () => {
    expect(arrivalPhrase('2026-05-12', '2026-05-15')).toBe('3 days before it was due')
    expect(arrivalPhrase('2026-05-15', '2026-05-15')).toBe('on the day it was due')
    expect(arrivalPhrase('2026-05-16', '2026-05-15')).toBe('1 day late')
  })
})

describe('letterPhrase', () => {
  const fmt = (d: string) => d.slice(0, 10)

  it('reassures when the letter went the day the award was made', () => {
    expect(
      letterPhrase(
        '2025-10-14T09:00:00.000Z',
        { status: 'sent', sentAt: '2025-10-14T11:30:00.000Z' },
        fmt,
      ),
    ).toBe('letter sent the same day')
  })

  it('dates a letter sent later', () => {
    expect(
      letterPhrase(
        '2025-10-14T09:00:00.000Z',
        { status: 'sent', sentAt: '2025-10-20T08:00:00.000Z' },
        fmt,
      ),
    ).toBe('letter sent 2025-10-20')
  })

  it('names a letter that has not gone', () => {
    expect(letterPhrase('2025-10-14', { status: 'draft', sentAt: null }, fmt)).toBe(
      'letter not sent yet',
    )
    expect(letterPhrase('2025-10-14', { status: 'failed', sentAt: null }, fmt)).toBe(
      'letter failed to send',
    )
    expect(letterPhrase('2025-10-14', null, fmt)).toBeNull()
  })
})

describe('averageAlignment', () => {
  it('is null with nothing scored', () => {
    expect(averageAlignment([])).toBeNull()
    expect(averageAlignment([{ applicationAlignment: null, programmeAlignment: null }])).toBeNull()
  })

  it('averages each report first, so a half-scored report counts once', () => {
    // Report A: (8 + 6) / 2 = 7. Report B: 9 on its own. Mean of the two = 8 — not
    // (8 + 6 + 9) / 3, which would let report A count twice.
    expect(
      averageAlignment([
        { applicationAlignment: { score: 8 }, programmeAlignment: { score: 6 } },
        { applicationAlignment: { score: 9 }, programmeAlignment: null },
      ]),
    ).toEqual({ score: 8, reports: 2 })
  })
})
