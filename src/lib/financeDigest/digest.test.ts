import { describe, expect, it } from 'vitest'
import { startOfWeekIso } from '../schedule'
import { digestDefaultOn, wantsDigest } from './optIn'
import { digestHasContent, digestTotal, type DigestItem, type DigestModel } from './types'
import { digestSubject, digestText, digestHtml } from './render'

function item(over: Partial<DigestItem> = {}): DigestItem {
  return {
    awardId: 'a1',
    organisationName: 'Rivermead Trust',
    programmeName: 'Youth Futures',
    dueDate: '2026-08-21',
    amount: 12500,
    instalmentNo: 1,
    bankFlagged: false,
    ...over,
  }
}

function model(over: Partial<DigestModel> = {}): DigestModel {
  return {
    clientName: 'Arete Foundation',
    recipientName: 'Jo Finance',
    weekOf: '2026-08-17',
    overdue: [],
    dueThisWeek: [item()],
    financeUrl: 'https://custodian.fund/finance',
    unsubscribeUrl: 'https://custodian.fund/api/digest-unsubscribe?u=u1&t=abc',
    ...over,
  }
}

describe('startOfWeekIso', () => {
  it('returns the Monday of the week', () => {
    // 2026-08-20 is a Thursday.
    expect(startOfWeekIso('2026-08-20')).toBe('2026-08-17')
    expect(startOfWeekIso('2026-08-17')).toBe('2026-08-17')
  })

  it('puts Sunday in the week that began six days earlier, not the next one', () => {
    // The trap in a `getUTCDay() === 0` week calculation. A digest run late on Sunday
    // must dedupe against the week it is finishing, not the one about to start.
    expect(startOfWeekIso('2026-08-23')).toBe('2026-08-17')
  })
})

describe('opt-in', () => {
  it('defaults on for finance and off for everyone else', () => {
    expect(digestDefaultOn('finance')).toBe(true)
    expect(digestDefaultOn('admin')).toBe(false)
    expect(digestDefaultOn('trustee')).toBe(false)
    expect(digestDefaultOn('superadmin')).toBe(false)
  })

  it('lets a stored choice beat the role default in both directions', () => {
    expect(wantsDigest({ role: 'finance', weeklyFinanceDigest: false })).toBe(false)
    expect(wantsDigest({ role: 'trustee', weeklyFinanceDigest: true })).toBe(true)
  })

  it('treats NULL as "never chosen", not as off', () => {
    // The whole point of the nullable column: an unsubscribe writes `false`, and only a
    // `false` keeps someone off the list. Reading NULL as off would silently unsubscribe
    // every finance user the moment the column shipped.
    expect(wantsDigest({ role: 'finance', weeklyFinanceDigest: null })).toBe(true)
  })
})

describe('content', () => {
  it('sends nothing when nothing is due', () => {
    expect(digestHasContent(model({ overdue: [], dueThisWeek: [] }))).toBe(false)
  })

  it('sends when only overdue money exists', () => {
    expect(digestHasContent(model({ overdue: [item()], dueThisWeek: [] }))).toBe(true)
  })

  it('totals items', () => {
    expect(digestTotal([item({ amount: 100 }), item({ amount: 250.5 })])).toBe(350.5)
  })
})

describe('subject', () => {
  it('leads with the money and names overdue separately', () => {
    const s = digestSubject(
      model({ overdue: [item({ amount: 4000 })], dueThisWeek: [item({ amount: 12500 })] }),
    )
    expect(s).toBe('£12,500 due this week, £4,000 overdue')
  })

  it('names the foundation when there is only one kind of news', () => {
    expect(digestSubject(model({ overdue: [], dueThisWeek: [item({ amount: 500 })] }))).toBe(
      '£500 due this week — Arete Foundation payments',
    )
  })
})

describe('body', () => {
  it('puts overdue before this week', () => {
    const text = digestText(
      model({
        overdue: [item({ organisationName: 'Old Debt Ltd', dueDate: '2026-07-01' })],
        dueThisWeek: [item({ organisationName: 'This Week Trust' })],
      }),
    )
    expect(text.indexOf('Old Debt Ltd')).toBeLessThan(text.indexOf('This Week Trust'))
    expect(text.indexOf('OVERDUE')).toBeLessThan(text.indexOf('DUE THIS WEEK'))
  })

  it('omits a section with nothing in it rather than printing an empty heading', () => {
    const text = digestText(model({ overdue: [] }))
    expect(text).not.toContain('OVERDUE')
    expect(digestHtml(model({ overdue: [] }))).not.toContain('Overdue')
  })

  it('carries the unsubscribe link in both parts', () => {
    const m = model()
    expect(digestText(m)).toContain(m.unsubscribeUrl)
    // The HTML href carries it entity-escaped (`&amp;`), which is correct HTML and what
    // a client resolves back to the original URL — asserting the raw string here would
    // be asserting a bug.
    expect(digestHtml(m)).toContain(m.unsubscribeUrl.replace(/&/g, '&amp;'))
  })

  it('flags bank details that failed the modulus check', () => {
    const m = model({ dueThisWeek: [item({ bankFlagged: true })] })
    expect(digestText(m)).toContain('bank details need checking')
    expect(digestHtml(m)).toContain('Bank details need checking')
  })

  it('escapes an organisation name into the HTML', () => {
    // Organisation names come from a foundation's own applicants via /api/apply — third
    // party text, going into HTML we email to a third party.
    const html = digestHtml(
      model({ dueThisWeek: [item({ organisationName: '<script>alert(1)</script> & Co' })] }),
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; Co')
  })

  it('renders a grant with no programme without printing an empty separator', () => {
    const text = digestText(model({ dueThisWeek: [item({ programmeName: null })] }))
    expect(text).not.toContain('· ·')
    expect(text).toContain('Rivermead Trust')
  })
})
