import { describe, it, expect } from 'vitest'
import {
  ACTION_CATEGORY,
  ACTION_LABEL,
  ACTION_VERB,
  FEED_ACTIONS,
  actionsInCategory,
  auditDetail,
  auditSubject,
  type AuditAction,
} from './audit'

// Every action, taken from the registry rather than typed out again — a list written
// twice is a list that goes stale.
const ALL_ACTIONS = Object.keys(ACTION_CATEGORY) as AuditAction[]

describe('the vocabulary is complete', () => {
  it('describes every action in words', () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_VERB[action], `verb for ${action}`).toBeTruthy()
      expect(ACTION_LABEL[action], `label for ${action}`).toBeTruthy()
    }
  })

  it('only feeds the dashboard actions it knows about', () => {
    for (const action of FEED_ACTIONS) expect(ALL_ACTIONS).toContain(action)
  })

  it('puts every action in exactly one category', () => {
    const grouped = (['decisions', 'money', 'reporting', 'access'] as const).flatMap((c) =>
      actionsInCategory(c),
    )
    expect(grouped.sort()).toEqual([...ALL_ACTIONS].sort())
  })
})

describe('auditDetail', () => {
  it('gives both sides of an amended payment', () => {
    expect(
      auditDetail('grant_payment_amended', {
        instalmentNo: 2,
        amount: { from: '10000', to: '12000' },
        dueDate: { from: '2026-03-01', to: '2026-09-01' },
      }),
    ).toBe('Instalment 2 · £10000 → £12000 · due 2026-03-01 → 2026-09-01')
  })

  it('reports only what changed', () => {
    expect(
      auditDetail('grant_payment_amended', { instalmentNo: 1, amount: { from: '500', to: '600' } }),
    ).toBe('Instalment 1 · £500 → £600')
  })

  // A date cleared back to "TBC" is a real edit. Dropping the empty side would have
  // rendered "due 2026-03-01", which reads as the date being SET to what it just left.
  it('spells out a due date cleared to TBC', () => {
    expect(
      auditDetail('grant_payment_amended', {
        instalmentNo: 3,
        dueDate: { from: '2026-03-01', to: null },
      }),
    ).toBe('Instalment 3 · due 2026-03-01 → no date')
  })

  it('distinguishes a recorded payment from a reversed one', () => {
    const meta = { instalmentNo: 1, amount: '25000', paidDate: '2026-08-22' }
    expect(auditDetail('grant_payment_recorded', meta)).toBe(
      'Instalment 1 · £25000 · paid 2026-08-22',
    )
    expect(auditDetail('grant_payment_reversed', meta)).toBe(
      'Instalment 1 · £25000 · was 2026-08-22',
    )
  })

  it('names the trustee a proxy vote was recorded for', () => {
    expect(
      auditDetail('application_vote_recorded_by_admin', { vote: 'yes', onBehalfOf: 'Jane Smith' }),
    ).toBe('Approved · on behalf of Jane Smith')
  })

  it('keeps a deleted comment readable, and truncates a long one', () => {
    expect(auditDetail('application_comment_deleted', { body: 'Concerned about the budget' })).toBe(
      '“Concerned about the budget”',
    )
    const long = 'x'.repeat(200)
    const out = auditDetail('application_comment_deleted', { body: long })
    expect(out.length).toBeLessThan(130)
    expect(out).toContain('…')
  })

  it('shows only the last four of an account number', () => {
    const detail = auditDetail('grant_bank_details_changed', {
      from: { sortCode: '20-00-00', last4: '1234' },
      to: { sortCode: '30-00-00', last4: '5678' },
    })
    expect(detail).toBe('20-00-00 ••••1234 → 30-00-00 ••••5678')
  })

  it('says nothing when an entry has nothing to add', () => {
    expect(auditDetail('application_shortlisted', null)).toBe('')
    expect(auditDetail('application_commented', {})).toBe('')
  })

  // The rows are written by six different call sites over time; a reader that throws on
  // an unexpected shape would take the whole screen down with it.
  it('survives metadata of the wrong shape', () => {
    for (const action of ALL_ACTIONS) {
      expect(() => auditDetail(action, null)).not.toThrow()
      expect(() => auditDetail(action, { from: 'not-an-object', amount: [] })).not.toThrow()
    }
  })
})

describe('auditSubject', () => {
  it('names the invitee and the key', () => {
    expect(auditSubject('invitation_sent', { email: 'ben@example.org', role: 'trustee' })).toBe(
      'ben@example.org',
    )
    expect(auditSubject('api_key_created', { name: 'Website form', last4: 'a1b2' })).toBe(
      'Website form (••••a1b2)',
    )
  })

  // Application-scoped rows take the organisation from the query's join instead.
  it('leaves application-scoped rows to the join', () => {
    expect(auditSubject('application_awarded', { amountAwarded: '1000' })).toBeNull()
  })
})
