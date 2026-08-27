import { describe, expect, it } from 'vitest'
import { canSeePayments, INVITABLE_ROLES } from './roles'

// `canSeePayments` gates three things that must agree: the Finance nav item, the
// `/finance` route guard, and — the one that actually matters — `listFinanceGrants` /
// `getFinanceGrant`, which return a grantee's full account number and sort code. It
// also decides whether `getApplication` returns the bank columns at all.
describe('canSeePayments', () => {
  it('admits the roles that run the money', () => {
    expect(canSeePayments('superadmin')).toBe(true)
    expect(canSeePayments('admin')).toBe(true)
    expect(canSeePayments('finance')).toBe(true)
  })

  it('excludes trustees', () => {
    // The whole point of the `finance` role: INVITABLE_ROLES describes it as "trustee
    // access, PLUS the payment schedule". If this ever returns true, that sentence is
    // false and every trustee can read bank details again.
    expect(canSeePayments('trustee')).toBe(false)
  })

  it('excludes anything it does not recognise', () => {
    // Allow-list, not a deny-list. The retired `manager` / `contributor` / `observer`
    // values were folded away by migration 0049, but a row predating it — or a role
    // added later and not thought about here — must fail closed rather than inherit
    // access to the payment schedule.
    for (const role of ['manager', 'contributor', 'observer', 'user', '', 'Finance']) {
      expect(canSeePayments(role)).toBe(false)
    }
  })

  it('classifies every invitable role explicitly', () => {
    // A new invitable role should force a decision here rather than defaulting to
    // "no payments" silently and being discovered by whoever it locks out.
    const decided: Record<string, boolean> = { admin: true, trustee: false, finance: true }
    for (const { value } of INVITABLE_ROLES) {
      expect(canSeePayments(value)).toBe(decided[value])
    }
  })
})
