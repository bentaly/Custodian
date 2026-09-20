import { describe, expect, it } from 'vitest'
import {
  awardNotificationsAvailable,
  awardNotificationsDefaultOn,
  wantsAwardNotifications,
} from './optIn'
import {
  awardNotificationHasContent,
  awardNotificationTotal,
  type AwardNotificationItem,
  type AwardNotificationModel,
} from './types'
import {
  awardNotificationHtml,
  awardNotificationSubject,
  awardNotificationText,
} from './render'

function item(over: Partial<AwardNotificationItem> = {}): AwardNotificationItem {
  return {
    awardId: 'a1',
    organisationName: 'Riverbank Youth Trust',
    programmeName: 'Youth Futures',
    amount: 24000,
    startDate: '2026-10-01',
    createdDate: '2026-09-17',
    ...over,
  }
}

function model(over: Partial<AwardNotificationModel> = {}): AwardNotificationModel {
  return {
    clientName: 'The Wrenfield Foundation',
    recipientName: 'Jo Admin',
    items: [item()],
    awardsUrl: 'https://custodian.fund/awards',
    unsubscribeUrl: 'https://custodian.fund/api/digest-unsubscribe?u=u1&t=abc&k=awards',
    ...over,
  }
}

describe('opt-in', () => {
  it('is offered to admins and finance, and to nobody else', () => {
    expect(awardNotificationsAvailable('admin')).toBe(true)
    expect(awardNotificationsAvailable('finance')).toBe(true)
    expect(awardNotificationsAvailable('trustee')).toBe(false)
    expect(awardNotificationsAvailable('superadmin')).toBe(false)
  })

  it('defaults on for both eligible roles, and NULL follows the default', () => {
    expect(awardNotificationsDefaultOn('admin')).toBe(true)
    expect(awardNotificationsDefaultOn('finance')).toBe(true)
    expect(wantsAwardNotifications({ role: 'admin', awardNotifications: null })).toBe(true)
    expect(wantsAwardNotifications({ role: 'finance', awardNotifications: null })).toBe(true)
    expect(wantsAwardNotifications({ role: 'admin', awardNotifications: false })).toBe(false)
  })

  it('never sends to an ineligible role, even with a stored true', () => {
    // The demotion case: an admin switched it on and later became a trustee. The column
    // is deliberately not cleared, so availability has to be re-checked at read time.
    expect(wantsAwardNotifications({ role: 'trustee', awardNotifications: true })).toBe(false)
    expect(wantsAwardNotifications({ role: 'superadmin', awardNotifications: true })).toBe(false)
  })
})

describe('totals and content', () => {
  it('sums the batch', () => {
    expect(awardNotificationTotal([item({ amount: 24000 }), item({ amount: 6500 })])).toBe(30500)
  })

  it('has nothing to send with no items', () => {
    expect(awardNotificationHasContent(model({ items: [] }))).toBe(false)
    expect(awardNotificationHasContent(model())).toBe(true)
  })
})

describe('subject', () => {
  it('names the charity when there is exactly one grant', () => {
    expect(awardNotificationSubject(model())).toBe('Riverbank Youth Trust set up: £24,000')
  })

  it('counts and totals the batch when there are several', () => {
    expect(
      awardNotificationSubject(
        model({ items: [item({ amount: 24000 }), item({ amount: 6500 })] }),
      ),
    ).toBe('2 new grants set up at The Wrenfield Foundation: £30,500')
  })
})

describe('rendering', () => {
  it('lists every grant in both parts', () => {
    const m = model({
      items: [
        item({ organisationName: 'Alpha Trust' }),
        item({ organisationName: 'Beta Collective' }),
      ],
    })
    for (const body of [awardNotificationText(m), awardNotificationHtml(m)]) {
      expect(body).toContain('Alpha Trust')
      expect(body).toContain('Beta Collective')
    }
  })

  it('omits the start date when there is none, rather than printing an empty one', () => {
    const none = awardNotificationText(model({ items: [item({ startDate: null })] }))
    expect(none).not.toContain('starts')
    expect(awardNotificationText(model())).toContain('starts')
  })

  it('escapes an organisation name into the HTML', () => {
    const html = awardNotificationHtml(
      model({ items: [item({ organisationName: 'A & B <Ltd>' })] }),
    )
    expect(html).toContain('A &amp; B &lt;Ltd&gt;')
    expect(html).not.toContain('<Ltd>')
  })

  it('carries the awards link and the unsubscribe link', () => {
    const m = model()
    expect(awardNotificationText(m)).toContain(m.unsubscribeUrl)
    expect(awardNotificationText(m)).toContain(m.awardsUrl)
    expect(awardNotificationHtml(m)).toContain(m.unsubscribeUrl.replace(/&/g, '&amp;'))
  })

  it('uses no em dashes in anything the recipient reads', () => {
    const m = model({ items: [item(), item({ programmeName: null })] })
    expect(awardNotificationSubject(m)).not.toContain('—')
    expect(awardNotificationText(m)).not.toContain('—')
    expect(awardNotificationHtml(m)).not.toContain('—')
  })
})
