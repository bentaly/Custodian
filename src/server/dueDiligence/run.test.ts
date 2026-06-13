import { describe, expect, it, vi } from 'vitest'
import { runDueDiligence } from './run'
import type { DueDiligenceFetchers } from './fetchers'

const NOW = new Date('2026-06-13T00:00:00Z')

/** A fetcher set that throws on everything — overridden per test. */
function stubFetchers(overrides: Partial<DueDiligenceFetchers> = {}): DueDiligenceFetchers {
  const notCalled = () => {
    throw new Error('fetcher should not have been called')
  }
  return {
    charityCommission: vi.fn(notCalled),
    charityFinancialHistory: vi.fn(notCalled),
    oscr: vi.fn(notCalled),
    companiesHouse: vi.fn(notCalled),
    companiesHouseFilingHistory: vi.fn(notCalled),
    threeSixtyGiving: vi.fn(async () => null),
    ...overrides,
  }
}

const activeCharityRaw = {
  reg_status: 'R',
  date_of_removal: null,
  insolvent: false,
  in_administration: false,
  date_of_registration: '2010-01-01',
  trustee_names: ['A', 'B', 'C', 'D'],
  latest_income: 1_000_000,
  latest_expenditure: 900_000,
  latest_acc_fin_year_end_date: '2025-12-31',
  reporting_status: 'Submission Received',
}

describe('runDueDiligence routing', () => {
  it('returns review with no checks when no numbers are supplied', async () => {
    const res = await runDueDiligence(
      { charityNumber: '', companyNumber: undefined, amountRequested: 1000 },
      { fetchers: stubFetchers(), now: NOW },
    )
    expect(res.status).toBe('review')
    expect(res.checks).toHaveLength(0)
  })

  it('routes SC-prefixed charity numbers to OSCR, not the Charity Commission', async () => {
    const oscr = vi.fn(async () => ({
      charityStatus: 'Active',
      mostRecentYearIncome: 200_000,
      mostRecentYearExpenditure: 150_000,
      yearEnd: '2026-01-01',
    }))
    const fetchers = stubFetchers({ oscr })
    const res = await runDueDiligence(
      { charityNumber: 'SC012345', companyNumber: undefined, amountRequested: 1000 },
      { fetchers, now: NOW },
    )
    expect(oscr).toHaveBeenCalledOnce()
    expect(fetchers.charityCommission).not.toHaveBeenCalled()
    expect(res.checks.some((c) => c.source === 'oscr')).toBe(true)
  })

  it('routes E&W charity numbers to the Charity Commission + financial history', async () => {
    const charityCommission = vi.fn(async () => activeCharityRaw)
    const charityFinancialHistory = vi.fn(async () => [])
    const res = await runDueDiligence(
      { charityNumber: '1234567', companyNumber: undefined, amountRequested: 1000 },
      { fetchers: stubFetchers({ charityCommission, charityFinancialHistory }), now: NOW },
    )
    expect(charityCommission).toHaveBeenCalledOnce()
    expect(charityFinancialHistory).toHaveBeenCalledOnce()
    expect(res.status).toBe('clear')
  })

  it('routes company numbers to Companies House + filing history', async () => {
    const companiesHouse = vi.fn(async () => ({
      company_status: 'active',
      date_of_creation: '2015-01-01',
      accounts: { overdue: false },
      confirmation_statement: { overdue: false },
    }))
    const companiesHouseFilingHistory = vi.fn(async () => ({ items: [{}, {}] }))
    const res = await runDueDiligence(
      { charityNumber: undefined, companyNumber: '09876543', amountRequested: 1000 },
      { fetchers: stubFetchers({ companiesHouse, companiesHouseFilingHistory }), now: NOW },
    )
    expect(companiesHouse).toHaveBeenCalledOnce()
    expect(res.status).toBe('clear')
  })

  it('screens both registers for a dual-registered (charity + company) applicant', async () => {
    const charityCommission = vi.fn(async () => activeCharityRaw)
    const charityFinancialHistory = vi.fn(async () => [])
    const companiesHouse = vi.fn(async () => ({
      company_status: 'active',
      date_of_creation: '2015-01-01',
      accounts: { overdue: false },
      confirmation_statement: { overdue: false },
    }))
    const companiesHouseFilingHistory = vi.fn(async () => ({ items: [{}] }))
    const res = await runDueDiligence(
      { charityNumber: '1234567', companyNumber: '09876543', amountRequested: 1000 },
      {
        fetchers: stubFetchers({
          charityCommission,
          charityFinancialHistory,
          companiesHouse,
          companiesHouseFilingHistory,
        }),
        now: NOW,
      },
    )
    expect(charityCommission).toHaveBeenCalledOnce()
    expect(companiesHouse).toHaveBeenCalledOnce()
    expect(res.checks.some((c) => c.source === 'charity_commission')).toBe(true)
    expect(res.checks.some((c) => c.source === 'companies_house')).toBe(true)
  })

  it('always runs the 360Giving supplementary check with a GB-CHC identifier', async () => {
    const threeSixtyGiving = vi.fn(async () => ({
      grants: [{ fundingOrganization: [{ name: 'Big Lottery' }], amountAwarded: 5000, awardDate: '2024-01-01' }],
    }))
    const res = await runDueDiligence(
      { charityNumber: '1234567', companyNumber: undefined, amountRequested: 1000 },
      {
        fetchers: stubFetchers({
          charityCommission: vi.fn(async () => activeCharityRaw),
          charityFinancialHistory: vi.fn(async () => []),
          threeSixtyGiving,
        }),
        now: NOW,
      },
    )
    expect(threeSixtyGiving).toHaveBeenCalledWith('GB-CHC-1234567')
    expect(res.checks.some((c) => c.source === 'threesixtygiving')).toBe(true)
  })
})

describe('runDueDiligence failure modes', () => {
  it('blocks when the charity number is not found (404 → null)', async () => {
    const res = await runDueDiligence(
      { charityNumber: '0000000', companyNumber: undefined, amountRequested: 1000 },
      {
        fetchers: stubFetchers({
          charityCommission: vi.fn(async () => null),
          charityFinancialHistory: vi.fn(async () => null),
        }),
        now: NOW,
      },
    )
    expect(res.status).toBe('blocked')
  })

  it('falls back to manual review when the primary register errors (never auto-passes)', async () => {
    const res = await runDueDiligence(
      { charityNumber: undefined, companyNumber: '09876543', amountRequested: 1000 },
      {
        fetchers: stubFetchers({
          companiesHouse: vi.fn(async () => {
            throw new Error('HTTP 503')
          }),
          companiesHouseFilingHistory: vi.fn(async () => null),
        }),
        now: NOW,
      },
    )
    expect(res.status).toBe('review')
  })

  it('does not let a 360Giving failure affect the overall status', async () => {
    const res = await runDueDiligence(
      { charityNumber: '1234567', companyNumber: undefined, amountRequested: 1000 },
      {
        fetchers: stubFetchers({
          charityCommission: vi.fn(async () => activeCharityRaw),
          charityFinancialHistory: vi.fn(async () => []),
          threeSixtyGiving: vi.fn(async () => {
            throw new Error('boom')
          }),
        }),
        now: NOW,
      },
    )
    expect(res.status).toBe('clear')
  })
})
