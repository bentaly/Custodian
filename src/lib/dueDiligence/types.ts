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

/**
 * Overall screening outcome stored on the application row.
 *
 * `no_registration` is not a flavour of `review`, and the difference is the whole point
 * of it: `review` means a check was attempted and a person must finish it, so it counts
 * on the dashboard and reads as work. An applicant with no charity or company number
 * has nothing to check against — there is no work, and nothing a re-run will change —
 * so it must not sit in an admin's flag count forever. What it does instead is say so
 * on the application (see the "Not captured" panel and the due diligence panel).
 */
export type DueDiligenceStatus =
  | 'pending'
  | 'clear'
  | 'warning'
  | 'blocked'
  | 'review'
  | 'no_registration'

/**
 * Every check the system can produce. Adding a check means adding a key here
 * and an entry in definitions.ts — the type system then forces both to stay in
 * sync with the registry.
 */
export type CheckKey =
  // Charity Commission (England & Wales)
  | 'cc_name_match'
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
  | 'oscr_registration_status'
  | 'oscr_name_match'
  | 'oscr_grant_vs_income'
  | 'oscr_spending_deficit'
  | 'oscr_accounts_overdue'
  // Companies House
  | 'ch_name_match'
  | 'ch_company_status'
  | 'ch_company_age'
  | 'ch_accounts_overdue'
  | 'ch_confirmation_statement_overdue'
  | 'ch_filing_history'
  // 360Giving
  | 'tsg_prior_funding'
  | 'tsg_capacity'

/**
 * What the registers say the applicant IS, as opposed to whether they pass screening.
 *
 * Due diligence already fetches all of this and throws it away — the checks keep only
 * their own verdicts, so the only trace an income figure left was prose inside a check
 * detail ("Grant is 42% of annual income"). A grants officer reading an application
 * wants the figure itself, next to the ask.
 *
 * Kept apart from `NormalizedCharity` on purpose: that shape is the INPUT to the pure
 * checks, and a display-only field appearing there invites a check to start reading it.
 * This one is written to the application row and read by the UI; nothing screens on it.
 */
export interface OrganisationProfile {
  /** Which register this was read from. Only the Charity Commission supplies it today. */
  source: 'charity_commission'
  /**
   * The charity's own prose description of what it does, from the annual return
   * (`charityoverview.activities`). This is the "who are these people" line — it is
   * written by the charity, not by us and not by a model, which is why it can be shown
   * without a hedge. Length is uncontrolled: the National Trust's is one sentence,
   * Cancer Research UK's runs to a paragraph. Clamp on display, never on write.
   */
  activities: string | null
  /** Total income for the latest filed accounting period. */
  latestIncome: number | null
  latestExpenditure: number | null
  /** End of the period the figures above cover — routinely 12-18 months ago. */
  financialPeriodEnd: string | null
  employees: number | null
  volunteers: number | null
  trusteeCount: number | null
  registeredSince: string | null
  /** e.g. "Charitable company", "CIO". */
  charityType: string | null
  /**
   * NOT AVAILABLE FROM THE REGISTER, and this null is the record of that.
   *
   * Checked against the live API on 2026-08-29 across five charities: neither
   * `allcharitydetailsv2` nor `charityoverview` (which IS annual return part B — it
   * carries the income and expenditure breakdowns, staff bands, government contract
   * counts) exposes any funds, reserves or assets field. The only sources are the
   * Commission's bulk data extract or asking the applicant on the form.
   *
   * The field is here so the screen can render its real empty state, and so whoever
   * wires the form field has one obvious place to write it.
   */
  unrestrictedReserves: number | null
  fetchedAt: string
}
