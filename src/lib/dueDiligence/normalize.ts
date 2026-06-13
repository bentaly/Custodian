// ─── Due diligence: normalized data shapes ──────────────────────────────────
//
// The raw registers use wildly different field names and casing (the Charity
// Commission `allcharitydetailsv2` endpoint is snake_case; Companies House
// nests under `accounts`/`confirmation_statement`; etc.). We normalize each
// raw response into a flat, typed shape here so the check logic never touches
// raw field names. Missing fields become `null` and surface as "unverified".

export interface NormalizedCharity {
  /** False when the registration number was not found on the register. */
  found: boolean
  /** Charity Commission `reg_status`: "R" registered, "RM" removed. */
  regStatus: string | null
  dateOfRemoval: string | null
  insolvent: boolean | null
  inAdministration: boolean | null
  dateOfRegistration: string | null
  trusteeCount: number | null
  latestIncome: number | null
  latestExpenditure: number | null
  /** End date of the latest accounting period (`latest_acc_fin_year_end_date`). */
  financialPeriodEnd: string | null
  /** `reporting_status` e.g. "Submission Overdue", "Submission Received Late". */
  reportingStatus: string | null
  /** Multi-year financials from the `charityfinancialhistory` endpoint, newest first. */
  financialHistory: FinancialYear[]
}

export interface FinancialYear {
  periodEnd: string | null
  income: number | null
  expenditure: number | null
}

export interface NormalizedOscrCharity {
  found: boolean
  income: number | null
  expenditure: number | null
  lastReturnsDate: string | null
}

export interface NormalizedCompany {
  found: boolean
  companyStatus: string | null
  dateOfCreation: string | null
  accountsOverdue: boolean | null
  confirmationStatementOverdue: boolean | null
  /** Number of entries in the filing history; null when the call failed. */
  filingCount: number | null
}

export interface NormalizedGrant {
  funder: string | null
  amount: number | null
  date: string | null
  purpose: string | null
}

export interface NormalizedGrants {
  /** Newest first. */
  grants: NormalizedGrant[]
}

// ── helpers ──

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 'True') return true
  if (v === 'false' || v === 'False') return false
  return null
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && !isNaN(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  return null
}

function toStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// ── Charity Commission: `allcharitydetailsv2/{number}/0` ──
// Field names per the official Charity Commission API data definition v1.1.
export function normalizeCharity(
  raw: Record<string, unknown> | null,
  history: unknown[] | null,
): NormalizedCharity {
  if (!raw || raw['_error'] || raw['_note']) {
    return emptyCharity(false)
  }
  // The register returns reg_status; a present record implies it was found.
  const trustees = Array.isArray(raw['trustee_names']) ? (raw['trustee_names'] as unknown[]).length : null

  return {
    found: true,
    regStatus: toStr(raw['reg_status']),
    dateOfRemoval: toStr(raw['date_of_removal']),
    insolvent: toBool(raw['insolvent']),
    inAdministration: toBool(raw['in_administration']),
    dateOfRegistration: toStr(raw['date_of_registration']),
    trusteeCount: trustees,
    latestIncome: toNum(raw['latest_income']),
    latestExpenditure: toNum(raw['latest_expenditure']),
    financialPeriodEnd: toStr(raw['latest_acc_fin_year_end_date']),
    reportingStatus: toStr(raw['reporting_status']),
    financialHistory: normalizeFinancialHistory(history),
  }
}

/** Returned by the `charityfinancialhistory` endpoint — an array of yearly rows. */
function normalizeFinancialHistory(history: unknown[] | null): FinancialYear[] {
  if (!Array.isArray(history)) return []
  const rows = history
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      periodEnd: toStr(r['fin_period_end_date']) ?? toStr(r['financial_year_end']),
      income: toNum(r['income']),
      expenditure: toNum(r['expenditure']) ?? toNum(r['spending']),
    }))
  // Newest first.
  return rows.sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? ''))
}

function emptyCharity(found: boolean): NormalizedCharity {
  return {
    found,
    regStatus: null,
    dateOfRemoval: null,
    insolvent: null,
    inAdministration: null,
    dateOfRegistration: null,
    trusteeCount: null,
    latestIncome: null,
    latestExpenditure: null,
    financialPeriodEnd: null,
    reportingStatus: null,
    financialHistory: [],
  }
}

// ── OSCR ──
// Real API returns a single flat object with `mostRecentYearIncome`,
// `mostRecentYearExpenditure`, and `yearEnd`. Older test stubs used a nested
// `mostRecentYear.income` shape — both are supported.
export function normalizeOscr(raw: unknown): NormalizedOscrCharity {
  const rec = Array.isArray(raw) ? raw[0] : raw
  if (!rec || typeof rec !== 'object' || (rec as Record<string, unknown>)['_error']) {
    return { found: false, income: null, expenditure: null, lastReturnsDate: null }
  }
  const r = rec as Record<string, unknown>
  const nested = r['mostRecentYear'] as Record<string, unknown> | undefined
  return {
    found: true,
    income: toNum(r['mostRecentYearIncome']) ?? toNum(nested?.['income']),
    expenditure: toNum(r['mostRecentYearExpenditure']) ?? toNum(nested?.['expenditure']),
    lastReturnsDate:
      toStr(r['yearEnd']) ?? toStr(r['lastReturnsDate']) ?? toStr(r['last_returns_date']),
  }
}

// ── Companies House: `GET /company/{number}` ──
export function normalizeCompany(
  raw: Record<string, unknown> | null,
  filingHistory: Record<string, unknown> | null,
): NormalizedCompany {
  if (!raw || raw['_error'] || raw['_note']) {
    return {
      found: false,
      companyStatus: null,
      dateOfCreation: null,
      accountsOverdue: null,
      confirmationStatementOverdue: null,
      filingCount: null,
    }
  }
  const accounts = (raw['accounts'] as Record<string, unknown>) ?? {}
  const confirmation = (raw['confirmation_statement'] as Record<string, unknown>) ?? {}
  let filingCount: number | null = null
  if (filingHistory && !filingHistory['_error']) {
    const items = filingHistory['items']
    filingCount = Array.isArray(items) ? items.length : toNum(filingHistory['total_count'])
  }
  return {
    found: true,
    companyStatus: toStr(raw['company_status']),
    dateOfCreation: toStr(raw['date_of_creation']),
    accountsOverdue: toBool(accounts['overdue']),
    confirmationStatementOverdue: toBool(confirmation['overdue']),
    filingCount,
  }
}

// ── 360Giving ──
// Response shape: { count, results: [{ grant_id, data: { amountAwarded, awardDate, fundingOrganization[{name}], title } }] }
export function normalizeGrants(raw: Record<string, unknown> | null): NormalizedGrants {
  if (!raw || raw['_error']) return { grants: [] }
  const results = Array.isArray(raw['results']) ? (raw['results'] as unknown[]) : []
  const grants = results
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const g = (r['data'] as Record<string, unknown>) ?? r
      const funding = Array.isArray(g['fundingOrganization']) ? (g['fundingOrganization'] as unknown[]) : []
      const funder = funding[0] && typeof funding[0] === 'object'
        ? toStr((funding[0] as Record<string, unknown>)['name'])
        : null
      return {
        funder,
        amount: toNum(g['amountAwarded']),
        date: toStr(g['awardDate']),
        purpose: toStr(g['title']) ?? toStr(g['description']),
      }
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return { grants }
}
