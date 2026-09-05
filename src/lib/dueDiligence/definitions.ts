// ─── Due diligence: check definitions registry ──────────────────────────────
//
// The single source of truth for what each check *means*. Stored records only
// carry { key, source, result, detail }; everything human-facing (label,
// severity, the spec rationale) is looked up here by key. The UI renders from
// this; the server uses `level` to roll individual results up into the overall
// status.

import type { CheckKey, CheckLevel, DueDiligenceSource } from './types'

export interface CheckDefinition {
  source: DueDiligenceSource
  label: string
  /** Severity when this check fails. */
  level: CheckLevel
  /** Why we run it — surfaced as helptext / tooltip. */
  rationale: string
  /**
   * What a PASS means, in a few words. Shown on the application in place of the
   * check's `detail` when a passing check has none — "Clear" says only that a
   * check ran, and a grants officer reading a list of them cannot tell what any
   * one of them actually confirmed.
   */
  passSummary: string
}

export const CHECK_DEFINITIONS: Record<CheckKey, CheckDefinition> = {
  // ── Charity Commission ──
  cc_name_match: {
    source: 'charity_commission',
    label: 'Registered name',
    passSummary: 'Register entry belongs to the applicant',
    level: 'warning',
    rationale:
      'A registration number that belongs to a different organisation makes every other check meaningless. Legal forms, acronyms and former names are allowed for.',
  },
  cc_registration_status: {
    source: 'charity_commission',
    label: 'Registration status',
    passSummary: 'Currently on the Charity Commission register',
    level: 'block',
    rationale: 'The charity must be currently registered with the Charity Commission.',
  },
  cc_not_removed: {
    source: 'charity_commission',
    label: 'Not removed from register',
    passSummary: 'No removal date on the register',
    level: 'block',
    rationale: 'A removal date indicates the charity has been struck off the register.',
  },
  cc_solvency: {
    source: 'charity_commission',
    label: 'Solvency',
    passSummary: 'Not insolvent and not in administration',
    level: 'block',
    rationale: 'Insolvency or being in administration is a hard block on funding.',
  },
  cc_registration_age: {
    source: 'charity_commission',
    label: 'Track record',
    passSummary: 'Registered for more than 12 months',
    level: 'warning',
    rationale: 'Registered within the last 12 months — limited track record.',
  },
  cc_trustee_count: {
    source: 'charity_commission',
    label: 'Number of trustees',
    passSummary: 'Three or more trustees on record',
    level: 'warning',
    rationale: 'Fewer than 3 trustees is a governance concern.',
  },
  cc_grant_vs_income: {
    source: 'charity_commission',
    label: 'Grant proportionality',
    passSummary: 'Request is under 30% of annual income',
    level: 'warning',
    rationale: 'Grant requested exceeds 30% of the charity’s annual income.',
  },
  cc_accounts_overdue: {
    source: 'charity_commission',
    label: 'Accounts up to date',
    passSummary: 'Accounts filed within the last 18 months',
    level: 'warning',
    rationale: 'Latest financial period ended more than 18 months ago — accounts overdue.',
  },
  cc_reporting_status: {
    source: 'charity_commission',
    label: 'Filing history',
    passSummary: 'Annual returns filed on time',
    level: 'warning',
    rationale: 'Late, overdue or defaulted annual returns are a governance flag.',
  },
  cc_income_trend: {
    source: 'charity_commission',
    label: 'Income trend',
    passSummary: 'No sustained decline in income',
    level: 'warning',
    rationale: 'Declining income over 2+ consecutive years is a soft flag.',
  },
  cc_spending_deficit: {
    source: 'charity_commission',
    label: 'Spending vs income',
    passSummary: 'Spending stayed within income',
    level: 'warning',
    rationale: 'A significant deficit sustained over 2+ years is a soft flag.',
  },

  // ── OSCR (Scotland) ──
  //
  // `oscr_registration_status` exists to close a real inequality: a charity number
  // absent from the Scottish register used to be reported against the proportionality
  // check, which is warning-level, while the identical failure in England & Wales is a
  // block. A struck-off Scottish charity therefore reached a board looking merely
  // questionable. Both registers now answer "is this body on the register at all" at
  // the same severity.
  oscr_registration_status: {
    source: 'oscr',
    label: 'Registration status',
    passSummary: 'On the Scottish Charity Register',
    level: 'block',
    rationale: 'The charity must appear on the Scottish Charity Register.',
  },
  oscr_name_match: {
    source: 'oscr',
    label: 'Registered name',
    passSummary: 'Register entry belongs to the applicant',
    level: 'warning',
    rationale:
      'A registration number that belongs to a different organisation makes every other check meaningless. Legal forms, acronyms and former names are allowed for.',
  },
  oscr_grant_vs_income: {
    source: 'oscr',
    label: 'Grant proportionality',
    passSummary: 'Request is under 30% of annual income',
    level: 'warning',
    rationale: 'Grant requested exceeds 30% of the charity’s annual income.',
  },
  oscr_spending_deficit: {
    source: 'oscr',
    label: 'Spending vs income',
    passSummary: 'Expenditure stayed within income',
    level: 'warning',
    rationale: 'Expenditure significantly exceeding income is a soft flag.',
  },
  oscr_accounts_overdue: {
    source: 'oscr',
    label: 'Accounts up to date',
    passSummary: 'Returns filed within the last 18 months',
    level: 'warning',
    rationale: 'Last returns more than 18 months ago — accounts overdue.',
  },

  // ── Companies House ──
  ch_name_match: {
    source: 'companies_house',
    label: 'Registered name',
    passSummary: 'Companies House entry belongs to the applicant',
    level: 'warning',
    rationale:
      'A registration number that belongs to a different organisation makes every other check meaningless. Legal forms, acronyms and former names are allowed for.',
  },
  ch_company_status: {
    source: 'companies_house',
    label: 'Company status',
    passSummary: 'Active at Companies House',
    level: 'block',
    rationale: 'The company must be active (not dissolved, liquidated, etc.).',
  },
  ch_company_age: {
    source: 'companies_house',
    label: 'Track record',
    passSummary: 'Incorporated more than 12 months ago',
    level: 'warning',
    rationale: 'Incorporated within the last 12 months — limited track record.',
  },
  ch_accounts_overdue: {
    source: 'companies_house',
    label: 'Accounts up to date',
    passSummary: 'Accounts are not overdue',
    level: 'warning',
    rationale: 'Overdue accounts are a governance flag.',
  },
  ch_confirmation_statement_overdue: {
    source: 'companies_house',
    label: 'Confirmation statement',
    passSummary: 'Confirmation statement is not overdue',
    level: 'warning',
    rationale: 'An overdue confirmation statement is a compliance flag.',
  },
  ch_filing_history: {
    source: 'companies_house',
    label: 'Filing history',
    passSummary: 'Filings on record at Companies House',
    level: 'warning',
    rationale: 'No filing history, or a pattern of late filings, is a soft flag.',
  },

  // ── 360Giving ──
  tsg_prior_funding: {
    source: 'threesixtygiving',
    label: 'Prior funding history',
    passSummary: 'Prior grants from other funders on record',
    level: 'info',
    rationale: 'Cross-references prior grants from other UK funders.',
  },
  // `warning`, not `info`: an organisation whose largest grant to date was £5,000
  // asking for £60,000 is a capacity question a board should be made to look at, and
  // a line that cannot move the status is a line that gets skimmed. It is the only
  // 360Giving check with any severity — the rest of that source stays informational.
  tsg_capacity: {
    source: 'threesixtygiving',
    label: 'Grant size vs funding history',
    passSummary: 'Request is in line with grants managed before',
    level: 'warning',
    rationale:
      'The amount requested against the largest grant this organisation is known to have managed before.',
  },
}

/** Severity ranking used to roll up the overall status. Higher = worse. */
export const LEVEL_RANK: Record<CheckLevel, number> = {
  info: 0,
  warning: 1,
  block: 2,
}
