// ─── Due diligence: check logic ─────────────────────────────────────────────
//
// Pure functions: normalized data + context → check records. No I/O, no dates
// pulled from the ambient clock (the caller passes `now`) so everything here is
// deterministic and trivially testable.

import { CHECK_DEFINITIONS, LEVEL_RANK } from './definitions'
import { bestNameMatch } from './nameMatch'
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
  /**
   * Grant amount requested, in pounds. Used for proportionality checks. Zero means
   * nobody has named a figure — which a partnership in the pipeline usually has not —
   * and the proportionality check reports `unverified` rather than a vacuous pass.
   */
  amountRequested: number
  /**
   * The organisation name as the APPLICANT gave it, checked against the name on the
   * register. Null when we don't hold one — reported as unverified, never as a pass.
   */
  applicantName: string | null
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

export function charityChecks(c: NormalizedCharity, ctx: CheckContext): DueDiligenceCheckRecord[] {
  // Registration number not found → hard block, nothing else to check.
  if (!c.found) {
    return [rec('cc_registration_status', 'fail', 'Registration number not found on the register')]
  }

  const out: DueDiligenceCheckRecord[] = []

  out.push(nameMatchCheck('cc_name_match', ctx.applicantName, [c.name]))

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
  const badReporting = [
    'Submission Overdue',
    'Submission Double Default',
    'Submission Received Late',
  ]
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

/**
 * Does the register entry we just screened belong to the applicant?
 *
 * Unverified rather than failed when either side is missing: "we could not check
 * this" and "the names disagree" are different facts, and only one of them is about
 * the applicant. Failing on absence would put a warning on every application from a
 * register that happens not to return a name.
 */
function nameMatchCheck(
  key: 'cc_name_match' | 'ch_name_match' | 'oscr_name_match',
  applicantName: string | null,
  registeredNames: (string | null)[],
): DueDiligenceCheckRecord {
  const candidates = registeredNames.filter((n): n is string => !!n?.trim())
  if (!applicantName?.trim() || candidates.length === 0) return rec(key, 'unverified')

  const best = bestNameMatch(applicantName, candidates)
  if (!best) return rec(key, 'unverified')

  if (!best.match) {
    return rec(
      key,
      'fail',
      `Applied as “${applicantName.trim()}” but the register shows “${candidates[0]}”`,
    )
  }
  if (best.viaPreviousName) {
    return rec(key, 'pass', `Matches a former registered name (“${best.matched}”)`)
  }
  return rec(
    key,
    'pass',
    best.reason === 'identical' ? best.matched : `${best.matched} — ${best.reason}`,
  )
}

function grantVsIncome(
  key: 'cc_grant_vs_income' | 'oscr_grant_vs_income',
  income: number | null,
  ctx: CheckContext,
): DueDiligenceCheckRecord {
  if (income == null || income <= 0) return rec(key, 'unverified')
  // No amount to weigh against the income is missing data, not a small grant. Screening
  // a PARTNERSHIP is where this shows up — an organisation in the pipeline often has not
  // named a figure yet — and without the guard the check reported "Grant is 0% of annual
  // income · Pass", which is the rule this module states in its own types being broken
  // in the plainest way: a check that never ran reading as one the organisation cleared.
  if (!ctx.amountRequested || ctx.amountRequested <= 0) return rec(key, 'unverified')
  const ratio = ctx.amountRequested / income
  return ratio > GRANT_INCOME_RATIO
    ? rec(key, 'fail', `Grant is ${Math.round(ratio * 100)}% of annual income`)
    : rec(key, 'pass', `Grant is ${Math.round(ratio * 100)}% of annual income`)
}

// ─── OSCR ─────────────────────────────────────────────────────────────────────

export function oscrChecks(o: NormalizedOscrCharity, ctx: CheckContext): DueDiligenceCheckRecord[] {
  // Not on the register at all. Reported against the registration check — a BLOCK,
  // matching the Charity Commission path. This used to be recorded against the
  // proportionality check, which is warning-level, so a struck-off Scottish charity
  // was reported more softly than an English one for the same failure.
  if (!o.found) {
    return [
      rec(
        'oscr_registration_status',
        'fail',
        'Charity number not found on the Scottish Charity Register',
      ),
    ]
  }

  const out: DueDiligenceCheckRecord[] = []
  out.push(rec('oscr_registration_status', 'pass', 'On the Scottish Charity Register'))
  out.push(nameMatchCheck('oscr_name_match', ctx.applicantName, [o.name]))
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

  out.push(nameMatchCheck('ch_name_match', ctx.applicantName, [c.name, ...c.previousNames]))

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

export function grantHistoryChecks(
  g: NormalizedGrants,
  ctx: CheckContext,
): DueDiligenceCheckRecord[] {
  if (g.grants.length === 0) {
    return [
      rec('tsg_prior_funding', 'unverified', 'No prior funding history found'),
      rec('tsg_capacity', 'unverified', 'No prior grants to compare against'),
    ]
  }

  // Name the grants rather than just their funders. We already hold amount, date and
  // purpose for up to fifty of them and were rendering two funder names; "£20,000 from
  // the X Trust in 2024 for youth work" is what a trustee actually wants to read.
  const detail = g.grants
    .slice(0, 3)
    .map((gr) => {
      const amount = gr.amount ? `£${gr.amount.toLocaleString('en-GB')} from ` : ''
      const funder = gr.funder ?? 'an unnamed funder'
      const year = gr.date?.slice(0, 4)
      return `${amount}${funder}${year ? ` (${year})` : ''}${gr.purpose ? ` — ${gr.purpose}` : ''}`
    })
    .join('; ')

  const summary = g.grants.length > 3 ? `${detail} — and ${g.grants.length - 3} more` : detail

  return [rec('tsg_prior_funding', 'pass', summary), capacityCheck(g, ctx)]
}

/**
 * How does this request compare with the largest grant they are known to have handled?
 *
 * Warning severity: a request several times larger than anything the organisation has
 * handled before is something a board should be made to look at, not a line of context
 * it can skim past.
 */
const CAPACITY_MULTIPLE = 3

function capacityCheck(g: NormalizedGrants, ctx: CheckContext): DueDiligenceCheckRecord {
  const amounts = g.grants.map((gr) => gr.amount).filter((n): n is number => n != null && n > 0)
  if (amounts.length === 0 || ctx.amountRequested <= 0) {
    return rec('tsg_capacity', 'unverified', 'Prior grant amounts not published')
  }

  const largest = Math.max(...amounts)
  const multiple = ctx.amountRequested / largest
  const largestText = `£${largest.toLocaleString('en-GB')}`

  return multiple >= CAPACITY_MULTIPLE
    ? rec(
        'tsg_capacity',
        'fail',
        `Request is ${multiple.toFixed(1)}× the largest prior grant on record (${largestText})`,
      )
    : rec('tsg_capacity', 'pass', `Largest prior grant on record ${largestText}`)
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
