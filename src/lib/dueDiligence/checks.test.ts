import { describe, expect, it } from 'vitest'
import {
  charityChecks,
  companyChecks,
  computeStatus,
  grantHistoryChecks,
  oscrChecks,
  type CheckContext,
} from './checks'
import type { NormalizedCharity, NormalizedCompany } from './normalize'
import type { CheckKey, DueDiligenceCheckRecord } from './types'

const NOW = new Date('2026-06-13T00:00:00Z')
const ctx = (amountRequested = 10_000): CheckContext => ({ amountRequested, now: NOW })

/** Pull a single check's outcome out of a result set by key. */
function outcome(records: DueDiligenceCheckRecord[], key: CheckKey) {
  return records.find((r) => r.key === key)?.result
}

const healthyCharity: NormalizedCharity = {
  found: true,
  regStatus: 'R',
  dateOfRemoval: null,
  insolvent: false,
  inAdministration: false,
  dateOfRegistration: '2010-01-01',
  trusteeCount: 6,
  latestIncome: 1_000_000,
  latestExpenditure: 900_000,
  financialPeriodEnd: '2025-12-31',
  reportingStatus: 'Submission Received',
  financialHistory: [
    { periodEnd: '2025-12-31', income: 1_000_000, expenditure: 900_000 },
    { periodEnd: '2024-12-31', income: 950_000, expenditure: 880_000 },
    { periodEnd: '2023-12-31', income: 900_000, expenditure: 850_000 },
  ],
}

describe('charityChecks', () => {
  it('passes a healthy charity on every check', () => {
    const records = charityChecks(healthyCharity, ctx())
    expect(records.every((r) => r.result === 'pass')).toBe(true)
    expect(computeStatus(records)).toBe('clear')
  })

  it('hard-blocks when the registration number is not found', () => {
    const records = charityChecks({ ...healthyCharity, found: false }, ctx())
    expect(records).toHaveLength(1)
    expect(outcome(records, 'cc_registration_status')).toBe('fail')
    expect(computeStatus(records)).toBe('blocked')
  })

  it('hard-blocks a removed charity', () => {
    const records = charityChecks(
      { ...healthyCharity, regStatus: 'RM', dateOfRemoval: '2023-04-01' },
      ctx(),
    )
    expect(outcome(records, 'cc_registration_status')).toBe('fail')
    expect(outcome(records, 'cc_not_removed')).toBe('fail')
    expect(computeStatus(records)).toBe('blocked')
  })

  it('hard-blocks an insolvent charity', () => {
    const records = charityChecks({ ...healthyCharity, insolvent: true }, ctx())
    expect(outcome(records, 'cc_solvency')).toBe('fail')
    expect(computeStatus(records)).toBe('blocked')
  })

  it('warns when registered less than 12 months ago', () => {
    const records = charityChecks({ ...healthyCharity, dateOfRegistration: '2026-01-01' }, ctx())
    expect(outcome(records, 'cc_registration_age')).toBe('fail')
    expect(computeStatus(records)).toBe('warning')
  })

  it('warns on fewer than 3 trustees', () => {
    const records = charityChecks({ ...healthyCharity, trusteeCount: 2 }, ctx())
    expect(outcome(records, 'cc_trustee_count')).toBe('fail')
  })

  it('warns when the grant exceeds 30% of income', () => {
    // £400k grant against £1m income = 40%.
    const records = charityChecks(healthyCharity, ctx(400_000))
    expect(outcome(records, 'cc_grant_vs_income')).toBe('fail')
  })

  it('marks proportionality unverified when income is missing', () => {
    const records = charityChecks({ ...healthyCharity, latestIncome: null }, ctx(400_000))
    expect(outcome(records, 'cc_grant_vs_income')).toBe('unverified')
  })

  it('warns when accounts are more than 18 months overdue', () => {
    const records = charityChecks({ ...healthyCharity, financialPeriodEnd: '2024-01-01' }, ctx())
    expect(outcome(records, 'cc_accounts_overdue')).toBe('fail')
  })

  it('warns on an overdue reporting status', () => {
    const records = charityChecks({ ...healthyCharity, reportingStatus: 'Submission Overdue' }, ctx())
    expect(outcome(records, 'cc_reporting_status')).toBe('fail')
  })

  it('warns on a declining income trend', () => {
    const declining: NormalizedCharity = {
      ...healthyCharity,
      financialHistory: [
        { periodEnd: '2025-12-31', income: 700_000, expenditure: 800_000 },
        { periodEnd: '2024-12-31', income: 850_000, expenditure: 820_000 },
        { periodEnd: '2023-12-31', income: 900_000, expenditure: 850_000 },
      ],
    }
    const records = charityChecks(declining, ctx())
    expect(outcome(records, 'cc_income_trend')).toBe('fail')
  })

  it('warns on a sustained spending deficit', () => {
    const deficit: NormalizedCharity = {
      ...healthyCharity,
      financialHistory: [
        { periodEnd: '2025-12-31', income: 800_000, expenditure: 950_000 },
        { periodEnd: '2024-12-31', income: 850_000, expenditure: 1_000_000 },
      ],
    }
    const records = charityChecks(deficit, ctx())
    expect(outcome(records, 'cc_spending_deficit')).toBe('fail')
  })

  it('leaves trend checks unverified without enough history', () => {
    const records = charityChecks({ ...healthyCharity, financialHistory: [] }, ctx())
    expect(outcome(records, 'cc_income_trend')).toBe('unverified')
    expect(outcome(records, 'cc_spending_deficit')).toBe('unverified')
  })
})

describe('companyChecks', () => {
  const healthyCompany: NormalizedCompany = {
    found: true,
    companyStatus: 'active',
    dateOfCreation: '2015-06-01',
    accountsOverdue: false,
    confirmationStatementOverdue: false,
    filingCount: 24,
  }

  it('passes a healthy active company', () => {
    const records = companyChecks(healthyCompany, ctx())
    expect(records.every((r) => r.result === 'pass')).toBe(true)
    expect(computeStatus(records)).toBe('clear')
  })

  it('hard-blocks a non-active company', () => {
    const records = companyChecks({ ...healthyCompany, companyStatus: 'dissolved' }, ctx())
    expect(outcome(records, 'ch_company_status')).toBe('fail')
    expect(computeStatus(records)).toBe('blocked')
  })

  it('hard-blocks when the company number is not found', () => {
    const records = companyChecks({ ...healthyCompany, found: false }, ctx())
    expect(computeStatus(records)).toBe('blocked')
  })

  it('warns on overdue accounts and confirmation statement', () => {
    const records = companyChecks(
      { ...healthyCompany, accountsOverdue: true, confirmationStatementOverdue: true },
      ctx(),
    )
    expect(outcome(records, 'ch_accounts_overdue')).toBe('fail')
    expect(outcome(records, 'ch_confirmation_statement_overdue')).toBe('fail')
    expect(computeStatus(records)).toBe('warning')
  })

  it('warns when there is no filing history', () => {
    const records = companyChecks({ ...healthyCompany, filingCount: 0 }, ctx())
    expect(outcome(records, 'ch_filing_history')).toBe('fail')
  })
})

describe('oscrChecks', () => {
  it('warns when the grant exceeds 30% of income', () => {
    const records = oscrChecks(
      { found: true, income: 100_000, expenditure: 90_000, lastReturnsDate: '2026-01-01' },
      ctx(50_000),
    )
    expect(outcome(records, 'oscr_grant_vs_income')).toBe('fail')
  })

  it('warns on overdue returns', () => {
    const records = oscrChecks(
      { found: true, income: 100_000, expenditure: 90_000, lastReturnsDate: '2024-01-01' },
      ctx(),
    )
    expect(outcome(records, 'oscr_accounts_overdue')).toBe('fail')
  })
})

describe('grantHistoryChecks', () => {
  it('is info-only and unverified when no grants are found', () => {
    const records = grantHistoryChecks({ grants: [] })
    expect(outcome(records, 'tsg_prior_funding')).toBe('unverified')
    // Info-level outcomes never downgrade the overall status.
    expect(computeStatus(records)).toBe('clear')
  })

  it('summarises the latest grants when present', () => {
    const records = grantHistoryChecks({
      grants: [
        { funder: 'Foundation A', amount: 50_000, date: '2025-01-01', purpose: 'Youth work' },
        { funder: 'Foundation B', amount: 20_000, date: '2024-01-01', purpose: 'Core costs' },
      ],
    })
    expect(outcome(records, 'tsg_prior_funding')).toBe('pass')
    expect(records[0]!.detail).toContain('Foundation A')
  })
})

describe('computeStatus', () => {
  it('prioritises blocks over warnings', () => {
    const records: DueDiligenceCheckRecord[] = [
      { key: 'cc_registration_status', source: 'charity_commission', result: 'fail', detail: null },
      { key: 'cc_trustee_count', source: 'charity_commission', result: 'fail', detail: null },
    ]
    expect(computeStatus(records)).toBe('blocked')
  })

  it('returns clear when only info checks fail', () => {
    const records: DueDiligenceCheckRecord[] = [
      { key: 'tsg_prior_funding', source: 'threesixtygiving', result: 'fail', detail: null },
    ]
    expect(computeStatus(records)).toBe('clear')
  })
})
