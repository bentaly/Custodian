import { describe, expect, it } from 'vitest'
import { reportsDigestAvailable, reportsDigestDefaultOn, wantsReportsDigest } from './optIn'
import { reportDigestHasContent, type ReportDigestItem, type ReportDigestModel } from './types'
import { reportDigestSubject, reportDigestText, reportDigestHtml } from './render'

function item(over: Partial<ReportDigestItem> = {}): ReportDigestItem {
  return {
    awardId: 'a1',
    organisationName: 'Rivermead Trust',
    programmeName: 'Youth Futures',
    label: 'Interim report',
    dueDate: '2026-08-21',
    daysLate: 0,
    ...over,
  }
}

function model(over: Partial<ReportDigestModel> = {}): ReportDigestModel {
  return {
    clientName: 'Arete Foundation',
    recipientName: 'Jo Admin',
    weekOf: '2026-08-17',
    overdue: [],
    dueThisWeek: [item()],
    reportsUrl: 'https://custodian.fund/reports',
    unsubscribeUrl: 'https://custodian.fund/api/digest-unsubscribe?u=u1&t=abc&k=reports',
    ...over,
  }
}

describe('opt-in', () => {
  it('is offered to admins and nobody else', () => {
    expect(reportsDigestAvailable('admin')).toBe(true)
    expect(reportsDigestAvailable('finance')).toBe(false)
    expect(reportsDigestAvailable('trustee')).toBe(false)
    expect(reportsDigestAvailable('superadmin')).toBe(false)
  })

  it('defaults on for admins', () => {
    expect(reportsDigestDefaultOn('admin')).toBe(true)
    expect(reportsDigestDefaultOn('trustee')).toBe(false)
  })

  it('lets an admin turn it off, and NULL follows the default', () => {
    expect(wantsReportsDigest({ role: 'admin', weeklyReportsDigest: null })).toBe(true)
    expect(wantsReportsDigest({ role: 'admin', weeklyReportsDigest: false })).toBe(false)
  })

  it('never sends to a non-admin, even with a stored true', () => {
    // The case this guards: an admin switched it on, then was demoted to trustee. The
    // column is deliberately not cleared on a role change, so availability has to be
    // re-checked at read time or they keep getting somebody else's chase list.
    expect(wantsReportsDigest({ role: 'trustee', weeklyReportsDigest: true })).toBe(false)
    expect(wantsReportsDigest({ role: 'finance', weeklyReportsDigest: true })).toBe(false)
  })
})

describe('reportDigestHasContent', () => {
  it('is false for a week with nothing expected, so nothing is sent', () => {
    expect(reportDigestHasContent(model({ overdue: [], dueThisWeek: [] }))).toBe(false)
  })

  it('is true when only overdue reports remain', () => {
    expect(reportDigestHasContent(model({ overdue: [item()], dueThisWeek: [] }))).toBe(true)
  })
})

describe('reportDigestSubject', () => {
  it('names both counts when there are both', () => {
    expect(reportDigestSubject(model({ overdue: [item(), item()] }))).toBe(
      '2 reports overdue, 1 due this week',
    )
  })

  it('singularises', () => {
    expect(reportDigestSubject(model({ overdue: [item()], dueThisWeek: [] }))).toBe(
      '1 report overdue at Arete Foundation',
    )
    expect(reportDigestSubject(model())).toBe('1 report due this week at Arete Foundation')
  })
})

describe('rendering', () => {
  it('puts overdue before due this week, in both parts', () => {
    const m = model({
      overdue: [item({ organisationName: 'Late Org', daysLate: 40 })],
      dueThisWeek: [item({ organisationName: 'Soon Org' })],
    })
    const text = reportDigestText(m)
    expect(text.indexOf('Late Org')).toBeLessThan(text.indexOf('Soon Org'))
    const html = reportDigestHtml(m)
    expect(html.indexOf('Late Org')).toBeLessThan(html.indexOf('Soon Org'))
  })

  it('says how late an overdue report is, and says nothing for one that is not', () => {
    const late = reportDigestText(model({ overdue: [item({ daysLate: 1 })], dueThisWeek: [] }))
    expect(late).toContain('(1 day late)')
    expect(reportDigestText(model())).not.toContain('late)')
  })

  it('escapes an organisation name into the HTML', () => {
    const html = reportDigestHtml(
      model({ dueThisWeek: [item({ organisationName: 'A & B <Ltd>' })] }),
    )
    expect(html).toContain('A &amp; B &lt;Ltd&gt;')
    expect(html).not.toContain('<Ltd>')
  })

  it('carries the reports link and the unsubscribe link in both parts', () => {
    const m = model()
    expect(reportDigestText(m)).toContain(m.unsubscribeUrl)
    expect(reportDigestText(m)).toContain(m.reportsUrl)
    // The HTML href is escaped, so the `&` separating the unsubscribe parameters comes
    // out as `&amp;`. That is correct in an attribute and every client unescapes it;
    // the plain-text part must carry the raw URL, which the two assertions above pin.
    expect(reportDigestHtml(m)).toContain(m.unsubscribeUrl.replace(/&/g, '&amp;'))
    expect(reportDigestHtml(m)).toContain(m.reportsUrl)
  })

  it('uses no em dashes in anything the recipient reads', () => {
    const m = model({ overdue: [item({ daysLate: 9 })] })
    expect(reportDigestSubject(m)).not.toContain('—')
    expect(reportDigestText(m)).not.toContain('—')
    expect(reportDigestHtml(m)).not.toContain('—')
  })
})
