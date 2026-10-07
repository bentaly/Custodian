// ─── Companies House: what the register says a company IS ────────────────────
//
// The company twin of the Charity Commission profile `runDueDiligence` builds, for an
// applicant that is a company and not a registered charity: a CIC, a community
// benefit society with a company number, a company limited by guarantee. Built on
// the profile call the company checks already make, plus the officers call for the
// director count.
//
// Companies House publishes no income, no expenditure and no description of what a
// company does. Its accounts are filed as documents, not figures. What it does
// publish is what kind of company this is, since when, its nature of business (SIC
// codes, put into words here) and whether its filings are up to date, which is the
// thing a grants officer actually checks on a CIC. A Montirex round with 20 CICs in
// it read "Companies House publishes no income or activity summary" on every one of
// them until this (2026-10-07).

import type { OrganisationProfile } from './types'
import { SIC_CODES } from './sicCodes'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// The register's `type` slugs a grant applicant is likely to be. Anything else falls
// back to the slug with its hyphens taken out, which is legible if not pretty.
const COMPANY_TYPES: Record<string, string> = {
  ltd: 'Private limited company',
  plc: 'Public limited company',
  'private-limited-guarant-nsc': 'Company limited by guarantee',
  'private-limited-guarant-nsc-limited-exemption': 'Company limited by guarantee',
  'private-limited-shares-section-30-exemption': 'Private limited company',
  'private-unlimited': 'Private unlimited company',
  'private-unlimited-nsc': 'Private unlimited company',
  'charitable-incorporated-organisation': 'Charitable incorporated organisation',
  'scottish-charitable-incorporated-organisation': 'Scottish charitable incorporated organisation',
  'registered-society-non-jurisdictional': 'Registered society',
  'industrial-and-provident-society': 'Industrial and provident society',
  llp: 'Limited liability partnership',
}

const ACCOUNTS_TYPES: Record<string, string> = {
  'micro-entity': 'Micro-entity',
  small: 'Small company',
  medium: 'Medium company',
  full: 'Full',
  group: 'Group',
  dormant: 'Dormant',
  'total-exemption-full': 'Total exemption full',
  'total-exemption-small': 'Total exemption small',
  'audit-exemption-subsidiary': 'Audit exemption (subsidiary)',
  'unaudited-abridged': 'Unaudited abridged',
  'audited-abridged': 'Audited abridged',
  initial: 'Initial',
  interim: 'Interim',
}

const words = (slug: string) => {
  const s = slug.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function companyTypeLabel(raw: Record<string, unknown>): string | null {
  const type = str(raw['type'])
  const base = type ? (COMPANY_TYPES[type] ?? words(type)) : null
  const cic =
    raw['is_community_interest_company'] === true ||
    str(raw['subtype']) === 'community-interest-company'
  if (!cic) return base
  // A CIC is a company limited by guarantee OR by shares, and which one matters to a
  // funder (an asset lock either way, but only one can pay dividends).
  const limited = type?.includes('guarant')
    ? 'limited by guarantee'
    : type === 'ltd' || type?.includes('shares')
      ? 'limited by shares'
      : null
  return limited ? `Community interest company (${limited})` : 'Community interest company'
}

/**
 * Current directors, counted off the officers list. Not the response's `active_count`,
 * which counts a company secretary too. The register lists current officers first and
 * resigned ones after, so a page that is short of the whole list (an old company can
 * have 130 officers on record) is still enough whenever every ACTIVE officer is on it;
 * where one is not, this says nothing rather than undercount. Null when the call failed.
 */
export function directorCount(officers: Record<string, unknown> | null): number | null {
  if (!officers || officers['_error'] || !Array.isArray(officers['items'])) return null
  const current = (officers['items'] as Array<Record<string, unknown>>).filter(
    (o) => !o['resigned_on'],
  )
  const active = officers['active_count']
  const total = officers['total_results']
  const complete = typeof total !== 'number' || total <= (officers['items'] as unknown[]).length
  if (!complete && current.length !== active) return null
  return current.filter((o) => String(o['officer_role'] ?? '').includes('director')).length
}

/**
 * The profile, or null when the register did not find the company: a profile built
 * from a 404 would describe an organisation we could not find.
 */
export function companyProfile(
  raw: Record<string, unknown> | null,
  officers: Record<string, unknown> | null,
  fetchedAt: string,
): OrganisationProfile | null {
  if (!raw || raw['_error'] || raw['_note'] || !str(raw['company_number'])) return null
  const accounts = (raw['accounts'] as Record<string, unknown> | undefined) ?? {}
  const last = (accounts['last_accounts'] as Record<string, unknown> | undefined) ?? {}
  const accountsType = str(last['type'])
  const sic = Array.isArray(raw['sic_codes']) ? (raw['sic_codes'] as unknown[]) : []
  return {
    source: 'companies_house',
    activities: null,
    registeredName: str(raw['company_name']),
    latestIncome: null,
    latestExpenditure: null,
    financialPeriodEnd: null,
    employees: null,
    volunteers: null,
    trusteeCount: null,
    registeredSince: str(raw['date_of_creation']),
    charityType: null,
    unrestrictedReserves: null,
    organisationNumber: null,
    companyNumber: str(raw['company_number']),
    companyType: companyTypeLabel(raw),
    companyStatus: str(raw['company_status']),
    // A code missing from the list is shown as the code, rather than dropped: the
    // list is the 2007 one and a new code is still a fact about the company.
    natureOfBusiness: sic
      .map((c) => str(c))
      .filter((c): c is string => !!c)
      .map((c) => SIC_CODES[c] ?? `SIC ${c}`),
    lastAccountsMadeUpTo: str(last['made_up_to']),
    lastAccountsType: accountsType ? ACCOUNTS_TYPES[accountsType] || words(accountsType) : null,
    accountsOverdue: typeof accounts['overdue'] === 'boolean' ? accounts['overdue'] : null,
    directorCount: directorCount(officers),
    fetchedAt,
  }
}

/** The company's public register page. */
export function companiesHouseUrl(companyNumber: string | null | undefined): string | null {
  return companyNumber
    ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`
    : null
}
