// ─── Due diligence: shared types ────────────────────────────────────────────
//
// These types are pure (no server/runtime dependencies) so they can be shared
// between the screening logic, the database schema, and the UI.

/** Which external register a check was derived from. */
export type DueDiligenceSource =
  | 'charity_commission'
  | 'oscr'
  | 'companies_house'
  | 'threesixtygiving'

/**
 * Outcome of a single check.
 *   pass       — the check ran and the organisation cleared it
 *   fail       — the check ran and the organisation tripped the flag
 *   unverified — the data needed for this check was missing/unavailable
 *                (per spec: treat missing data as "Not verified", never "Pass")
 */
export type CheckOutcome = 'pass' | 'fail' | 'unverified'

/** Severity of a check if it fails. A UI concern, derived from the check key. */
export type CheckLevel = 'block' | 'warning' | 'info'

/**
 * What we persist per application. Deliberately lean: `level` and `label` are
 * NOT stored — they are looked up from the definitions registry by `key`.
 */
export interface DueDiligenceCheckRecord {
  key: CheckKey
  source: DueDiligenceSource
  result: CheckOutcome
  /** Human-readable context for the outcome, e.g. "Grant is 42% of annual income". */
  detail: string | null
}

/** Overall screening outcome stored on the application row. */
export type DueDiligenceStatus = 'pending' | 'clear' | 'warning' | 'blocked' | 'review'

/**
 * Every check the system can produce. Adding a check means adding a key here
 * and an entry in definitions.ts — the type system then forces both to stay in
 * sync with the registry.
 */
export type CheckKey =
  // Charity Commission (England & Wales)
  | 'cc_registration_status'
  | 'cc_not_removed'
  | 'cc_solvency'
  | 'cc_registration_age'
  | 'cc_trustee_count'
  | 'cc_grant_vs_income'
  | 'cc_accounts_overdue'
  | 'cc_reporting_status'
  | 'cc_income_trend'
  | 'cc_spending_deficit'
  // OSCR (Scotland)
  | 'oscr_grant_vs_income'
  | 'oscr_spending_deficit'
  | 'oscr_accounts_overdue'
  // Companies House
  | 'ch_company_status'
  | 'ch_company_age'
  | 'ch_accounts_overdue'
  | 'ch_confirmation_statement_overdue'
  | 'ch_filing_history'
  // 360Giving
  | 'tsg_prior_funding'
