// ─── Due diligence: check logic ─────────────────────────────────────────────
//
// Pure functions: normalized data + context → check records. No I/O, no dates
// pulled from the ambient clock (the caller passes `now`) so everything here is
// deterministic and trivially testable.

import { CHECK_DEFINITIONS, LEVEL_RANK } from './definitions'
import type {
  NormalizedCharity,
  NormalizedCompany,
  NormalizedGrants,
  NormalizedOscrCharity,
} from './normalize'
import type {
  CheckKey,
  CheckOutcome,
  DueDiligenceCheckRecord,
  DueDiligenceSource,
  DueDiligenceStatus,
} from './types'

export interface CheckContext {
  /** Grant amount requested, in pounds. Used for proportionality checks. */
  amountRequested: number
  /** Reference "now" — injected so checks are deterministic in tests. */
  now: Date
}

const GRANT_INCOME_RATIO = 0.3
const NEW_ORG_MONTHS = 12
const ACCOUNTS_OVERDUE_MONTHS = 18

// ── date helpers ──

function monthsSince(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null
  const then = new Date(dateStr)
  if (isNaN(then.getTime())) return null
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
}

// ── builders ──

function rec(
  key: CheckKey,
  result: CheckOutcome,
  detail: string | null = null,
): DueDiligenceCheckRecord {
  return { key, source: CHECK_DEFINITIONS[key].source, result, detail }
}

// ─── Charity Commission ──────────────────────────────────────────────────────

export function charityChecks(
  c: NormalizedCharity,
  ctx: CheckContext,
): DueDiligenceCheckRecord[] {
  // Registration number not found → hard block, nothing else to check.
  if (!c.found) {
    return [rec('cc_registration_status', 'fail', 'Registration number not found on the register')]
  }

  const out: DueDiligenceCheckRecord[] = []

  // reg_status: "R" registered, "RM" removed.
  out.push(
    c.regStatus == null
      ? rec('cc_registration_status', 'unverified')
      : c.regStatus === 'R'
        ? rec('cc_registration_status', 'pass', 'Registered')
        : rec('cc_registration_status', 'fail', `Status is "${c.regStatus}" (not Registered)`),
  )

  out.push(
    c.dateOfRemoval
      ? rec('cc_not_removed', 'fail', `Removed from register on ${c.dateOfRemoval}`)
      : rec('cc_not_removed', 'pass'),
  )

  if (c.insolvent == null && c.inAdministration == null) {
    out.push(rec('cc_solvency', 'unverified'))
  } else if (c.insolvent || c.inAdministration) {
    out.push(
      rec(
        'cc_solvency',
        'fail',
        c.insolvent ? 'Charity is insolvent' : 'Charity is in administration',
      ),
    )
  } else {
    out.push(rec('cc_solvency', 'pass'))
  }

  // Registered within the last 12 months → limited track record.
  const ageMonths = monthsSince(c.dateOfRegistration, ctx.now)
  out.push(
    ageMonths == null
      ? rec('cc_registration_age', 'unverified')
      : ageMonths < NEW_ORG_MONTHS
        ? rec('cc_registration_age', 'fail', `Registered ${ageMonths} months ago`)
        : rec('cc_registration_age', 'pass'),
  )

  out.push(
    c.trusteeCount == null
      ? rec('cc_trustee_count', 'unverified')
      : c.trusteeCount < 3
        ? rec('cc_trustee_count', 'fail', `${c.trusteeCount} trustee(s)`)
        : rec('cc_trustee_count', 'pass', `${c.trusteeCount} trustees`),
  )

  out.push(grantVsIncome('cc_grant_vs_income', c.latestIncome, ctx))

  // Latest accounting period ended > 18 months ago → accounts overdue.
  const periodMonths = monthsSince(c.financialPeriodEnd, ctx.now)
  out.push(
    periodMonths == null
      ? rec('cc_accounts_overdue', 'unverified')
      : periodMonths > ACCOUNTS_OVERDUE_MONTHS
        ? rec('cc_accounts_overdue', 'fail', `Latest accounts ended ${periodMonths} months ago`)
        : rec('cc_accounts_overdue', 'pass'),
  )

  // reporting_status flags late/overdue/defaulted returns.
  const badReporting = ['Submission Overdue', 'Submission Double Default', 'Submission Received Late']
  out.push(
    c.reportingStatus == null
      ? rec('cc_reporting_status', 'unverified')
      : badReporting.includes(c.reportingStatus)
        ? rec('cc_reporting_status', 'fail', c.reportingStatus)
        : rec('cc_reporting_status', 'pass', c.reportingStatus),
  )

  // Multi-year trends (from the financial-history endpoint).
  out.push(incomeTrend(c, ctx))
  out.push(spendingDeficit('cc_spending_deficit', c, ctx))

  return out
}

/** Declining income across 2+ consecutive years (needs 3 data points). */
function incomeTrend(c: NormalizedCharity, _ctx: CheckContext): DueDiligenceCheckRecord {
  const incomes = c.financialHistory.map((y) => y.income).filter((n): n is number => n != null)
  if (incomes.length < 3) return rec('cc_income_trend', 'unverified')
  // history is newest-first; declining means each newer year < the next older year.
  const declining = incomes[0]! < incomes[1]! && incomes[1]! < incomes[2]!
  return declining
    ? rec('cc_income_trend', 'fail', 'Income declined over the last 2 years')
    : rec('cc_income_trend', 'pass')
}

/** Deficit (spend > income) sustained over 2+ years. */
function spendingDeficit(
  key: 'cc_spending_deficit',
  c: NormalizedCharity,
  _ctx: CheckContext,
): DueDiligenceCheckRecord {
  const years = c.financialHistory.filter((y) => y.income != null && y.expenditure != null)
  if (years.length < 2) return rec(key, 'unverified')
  const deficitYears = years.slice(0, 2).filter((y) => y.expenditure! > y.income!)
  return deficitYears.length >= 2
    ? rec(key, 'fail', 'Spending exceeded income for 2+ consecutive years')
    : rec(key, 'pass')
}

function grantVsIncome(
  key: 'cc_grant_vs_income' | 'oscr_grant_vs_income',
  income: number | null,
  ctx: CheckContext,
): DueDiligenceCheckRecord {
  if (income == null || income <= 0) return rec(key, 'unverified')
  const ratio = ctx.amountRequested / income
  return ratio > GRANT_INCOME_RATIO
    ? rec(key, 'fail', `Grant is ${Math.round(ratio * 100)}% of annual income`)
    : rec(key, 'pass', `Grant is ${Math.round(ratio * 100)}% of annual income`)
}

// ─── OSCR ─────────────────────────────────────────────────────────────────────

export function oscrChecks(o: NormalizedOscrCharity, ctx: CheckContext): DueDiligenceCheckRecord[] {
  if (!o.found) {
    return [rec('oscr_grant_vs_income', 'fail', 'Charity not found on the OSCR register')]
  }

  const out: DueDiligenceCheckRecord[] = []
  out.push(grantVsIncome('oscr_grant_vs_income', o.income, ctx))

  if (o.income == null || o.expenditure == null) {
    out.push(rec('oscr_spending_deficit', 'unverified'))
  } else {
    out.push(
      o.expenditure > o.income
        ? rec('oscr_spending_deficit', 'fail', 'Expenditure exceeds income')
        : rec('oscr_spending_deficit', 'pass'),
    )
  }

  const months = monthsSince(o.lastReturnsDate, ctx.now)
  out.push(
    months == null
      ? rec('oscr_accounts_overdue', 'unverified')
      : months > ACCOUNTS_OVERDUE_MONTHS
        ? rec('oscr_accounts_overdue', 'fail', `Last returns ${months} months ago`)
        : rec('oscr_accounts_overdue', 'pass'),
  )

  return out
}

// ─── Companies House ──────────────────────────────────────────────────────────

export function companyChecks(c: NormalizedCompany, ctx: CheckContext): DueDiligenceCheckRecord[] {
  if (!c.found) {
    return [rec('ch_company_status', 'fail', 'Company number not found at Companies House')]
  }

  const out: DueDiligenceCheckRecord[] = []

  out.push(
    c.companyStatus == null
      ? rec('ch_company_status', 'unverified')
      : c.companyStatus === 'active'
        ? rec('ch_company_status', 'pass', 'Active')
        : rec('ch_company_status', 'fail', `Status is "${c.companyStatus}"`),
  )

  const ageMonths = monthsSince(c.dateOfCreation, ctx.now)
  out.push(
    ageMonths == null
      ? rec('ch_company_age', 'unverified')
      : ageMonths < NEW_ORG_MONTHS
        ? rec('ch_company_age', 'fail', `Incorporated ${ageMonths} months ago`)
        : rec('ch_company_age', 'pass'),
  )

  out.push(
    c.accountsOverdue == null
      ? rec('ch_accounts_overdue', 'unverified')
      : c.accountsOverdue
        ? rec('ch_accounts_overdue', 'fail', 'Accounts overdue')
        : rec('ch_accounts_overdue', 'pass'),
  )

  out.push(
    c.confirmationStatementOverdue == null
      ? rec('ch_confirmation_statement_overdue', 'unverified')
      : c.confirmationStatementOverdue
        ? rec('ch_confirmation_statement_overdue', 'fail', 'Confirmation statement overdue')
        : rec('ch_confirmation_statement_overdue', 'pass'),
  )

  out.push(
    c.filingCount == null
      ? rec('ch_filing_history', 'unverified')
      : c.filingCount === 0
        ? rec('ch_filing_history', 'fail', 'No filing history')
        : rec('ch_filing_history', 'pass', `${c.filingCount} filings`),
  )

  return out
}

// ─── 360Giving ──────────────────────────────────────────────────────────────

export function grantHistoryChecks(g: NormalizedGrants): DueDiligenceCheckRecord[] {
  if (g.grants.length === 0) {
    return [rec('tsg_prior_funding', 'unverified', 'No prior funding history found')]
  }
  const latest = g.grants.slice(0, 2)
  const detail = latest
    .map((gr) => `${gr.funder ?? 'Unknown funder'}${gr.amount ? ` £${gr.amount.toLocaleString('en-GB')}` : ''}`)
    .join('; ')
  return [rec('tsg_prior_funding', 'pass', detail)]
}

// ─── Status roll-up ───────────────────────────────────────────────────────────

/**
 * Roll individual check records up into an overall status.
 * A failed `block` check → 'blocked'; a failed `warning` → 'warning';
 * otherwise 'clear'. Failed `info` checks are informational and never downgrade.
 */
export function computeStatus(records: DueDiligenceCheckRecord[]): DueDiligenceStatus {
  let worst = -1
  for (const r of records) {
    if (r.result !== 'fail') continue
    const level = CHECK_DEFINITIONS[r.key].level
    if (level === 'info') continue
    worst = Math.max(worst, LEVEL_RANK[level])
  }
  if (worst >= LEVEL_RANK.block) return 'blocked'
  if (worst >= LEVEL_RANK.warning) return 'warning'
  return 'clear'
}

/** All sources represented in a set of records — handy for grouping in the UI. */
export function sourcesInRecords(records: DueDiligenceCheckRecord[]): DueDiligenceSource[] {
  return [...new Set(records.map((r) => r.source))]
}
