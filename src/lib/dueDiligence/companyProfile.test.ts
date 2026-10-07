import { describe, it, expect } from 'vitest'
import { companyProfile, companyTypeLabel, directorCount } from './companyProfile'

// Evolving Mindset CIC's register entry as it read on 2026-10-07, trimmed.
const raw = {
  company_number: '12240451',
  company_name: 'EVOLVING MINDSET CIC',
  company_status: 'active',
  date_of_creation: '2019-10-02',
  type: 'private-limited-guarant-nsc',
  subtype: 'community-interest-company',
  is_community_interest_company: true,
  sic_codes: ['85600', '00001'],
  accounts: {
    overdue: false,
    last_accounts: { made_up_to: '2025-10-31', type: 'total-exemption-full' },
  },
}

const officers = {
  total_results: 4,
  items: [
    { officer_role: 'director' },
    { officer_role: 'director' },
    { officer_role: 'secretary' },
    { officer_role: 'director', resigned_on: '2023-01-01' },
  ],
}

describe('companyProfile', () => {
  it('states what the register publishes and leaves the figures it does not', () => {
    const p = companyProfile(raw, officers, '2026-10-07T00:00:00Z')!
    expect(p).toMatchObject({
      source: 'companies_house',
      registeredName: 'EVOLVING MINDSET CIC',
      registeredSince: '2019-10-02',
      companyNumber: '12240451',
      companyType: 'Community interest company (limited by guarantee)',
      natureOfBusiness: ['Educational support services', 'SIC 00001'],
      lastAccountsMadeUpTo: '2025-10-31',
      lastAccountsType: 'Total exemption full',
      accountsOverdue: false,
      directorCount: 2,
      latestIncome: null,
      activities: null,
    })
  })

  it('builds nothing from a company the register did not find', () => {
    expect(companyProfile(null, null, 'x')).toBeNull()
    expect(companyProfile({ _error: 'not found' }, null, 'x')).toBeNull()
  })
})

describe('directorCount', () => {
  it('counts current directors, not the secretary', () => {
    expect(directorCount(officers)).toBe(2)
  })

  // The Federation of Groundwork Trusts: 133 officers on record, 17 of them current.
  it('counts from a partial page when every current officer is on it', () => {
    const items = [
      { officer_role: 'secretary' },
      ...Array.from({ length: 16 }, () => ({ officer_role: 'director' })),
      ...Array.from({ length: 83 }, () => ({
        officer_role: 'director',
        resigned_on: '2001-01-01',
      })),
    ]
    expect(directorCount({ active_count: 17, total_results: 133, items })).toBe(16)
  })

  it('says nothing rather than undercount a list it only saw part of', () => {
    expect(
      directorCount({ active_count: 5, total_results: 150, items: [{ officer_role: 'director' }] }),
    ).toBeNull()
    expect(directorCount(null)).toBeNull()
  })
})

describe('companyTypeLabel', () => {
  it('names a CIC by how it is limited', () => {
    expect(companyTypeLabel({ type: 'ltd', subtype: 'community-interest-company' })).toBe(
      'Community interest company (limited by shares)',
    )
    expect(companyTypeLabel({ type: 'private-limited-guarant-nsc' })).toBe(
      'Company limited by guarantee',
    )
  })
})
