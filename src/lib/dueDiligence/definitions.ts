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
}

export const CHECK_DEFINITIONS: Record<CheckKey, CheckDefinition> = {
  // ── Charity Commission ──
  cc_registration_status: {
    source: 'charity_commission',
    label: 'Registration status',
    level: 'block',
    rationale: 'The charity must be currently registered with the Charity Commission.',
  },
  cc_not_removed: {
    source: 'charity_commission',
    label: 'Not removed from register',
    level: 'block',
    rationale: 'A removal date indicates the charity has been struck off the register.',
  },
  cc_solvency: {
    source: 'charity_commission',
    label: 'Solvency',
    level: 'block',
    rationale: 'Insolvency or being in administration is a hard block on funding.',
  },
  cc_registration_age: {
    source: 'charity_commission',
    label: 'Track record',
    level: 'warning',
    rationale: 'Registered within the last 12 months — limited track record.',
  },
  cc_trustee_count: {
    source: 'charity_commission',
    label: 'Number of trustees',
    level: 'warning',
    rationale: 'Fewer than 3 trustees is a governance concern.',
  },
  cc_grant_vs_income: {
    source: 'charity_commission',
    label: 'Grant proportionality',
    level: 'warning',
    rationale: 'Grant requested exceeds 30% of the charity’s annual income.',
  },
  cc_accounts_overdue: {
    source: 'charity_commission',
    label: 'Accounts up to date',
    level: 'warning',
    rationale: 'Latest financial period ended more than 18 months ago — accounts overdue.',
  },
  cc_reporting_status: {
    source: 'charity_commission',
    label: 'Filing history',
    level: 'warning',
    rationale: 'Late, overdue or defaulted annual returns are a governance flag.',
  },
  cc_income_trend: {
    source: 'charity_commission',
    label: 'Income trend',
    level: 'warning',
    rationale: 'Declining income over 2+ consecutive years is a soft flag.',
  },
  cc_spending_deficit: {
    source: 'charity_commission',
    label: 'Spending vs income',
    level: 'warning',
    rationale: 'A significant deficit sustained over 2+ years is a soft flag.',
  },

  // ── OSCR (Scotland) ──
  oscr_grant_vs_income: {
    source: 'oscr',
    label: 'Grant proportionality',
    level: 'warning',
    rationale: 'Grant requested exceeds 30% of the charity’s annual income.',
  },
  oscr_spending_deficit: {
    source: 'oscr',
    label: 'Spending vs income',
    level: 'warning',
    rationale: 'Expenditure significantly exceeding income is a soft flag.',
  },
  oscr_accounts_overdue: {
    source: 'oscr',
    label: 'Accounts up to date',
    level: 'warning',
    rationale: 'Last returns more than 18 months ago — accounts overdue.',
  },

  // ── Companies House ──
  ch_company_status: {
    source: 'companies_house',
    label: 'Company status',
    level: 'block',
    rationale: 'The company must be active (not dissolved, liquidated, etc.).',
  },
  ch_company_age: {
    source: 'companies_house',
    label: 'Track record',
    level: 'warning',
    rationale: 'Incorporated within the last 12 months — limited track record.',
  },
  ch_accounts_overdue: {
    source: 'companies_house',
    label: 'Accounts up to date',
    level: 'warning',
    rationale: 'Overdue accounts are a governance flag.',
  },
  ch_confirmation_statement_overdue: {
    source: 'companies_house',
    label: 'Confirmation statement',
    level: 'warning',
    rationale: 'An overdue confirmation statement is a compliance flag.',
  },
  ch_filing_history: {
    source: 'companies_house',
    label: 'Filing history',
    level: 'warning',
    rationale: 'No filing history, or a pattern of late filings, is a soft flag.',
  },

  // ── 360Giving ──
  tsg_prior_funding: {
    source: 'threesixtygiving',
    label: 'Prior funding history',
    level: 'info',
    rationale: 'Cross-references prior grants from other UK funders.',
  },
}

/** Severity ranking used to roll up the overall status. Higher = worse. */
export const LEVEL_RANK: Record<CheckLevel, number> = {
  info: 0,
  warning: 1,
  block: 2,
}
