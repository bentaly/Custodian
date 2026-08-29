// ─── Due diligence: orchestrator ─────────────────────────────────────────────
//
// Routes an application to the right register(s) per the API spec, fetches,
// normalizes, runs the pure checks, and rolls the results up into a status.
// Network access is injected via `fetchers` so this is fully unit-testable.

import {
  charityChecks,
  companyChecks,
  computeStatus,
  grantHistoryChecks,
  oscrChecks,
  normalizeCharity,
  normalizeCompany,
  normalizeGrants,
  normalizeOscr,
  type CheckContext,
  type DueDiligenceCheckRecord,
  type DueDiligenceStatus,
} from '../../lib/dueDiligence'
import { liveFetchers, type DueDiligenceFetchers } from './fetchers'

export interface RunDueDiligenceInput {
  /** Charity Commission / OSCR number. SC-prefixed numbers route to OSCR. */
  charityNumber: string | null | undefined
  /** Companies House number. */
  companyNumber: string | null | undefined
  /**
   * The organisation name the applicant gave, checked against the register's own.
   * Required rather than optional so a new call site cannot quietly omit it and turn
   * the one check that validates the number itself into a silent "not verified".
   */
  organisationName: string | null | undefined
  amountRequested: number
}

/**
 * A company number as Companies House expects it: eight characters, zero-padded.
 *
 * Companies House 404s on an unpadded number — "612172" is not found, "00612172" is an
 * active company — and an unpadded number is exactly what foundations' forms collect,
 * because it is how the Charity Commission's own register publishes it. Without this the
 * same valid company screened `clear` or `blocked` depending on how the applicant happened
 * to type it, and `blocked` is the answer that stops a grant.
 *
 * Prefixed numbers (SC…, NI…, RC…, OC…) are already canonical and are only upper-cased —
 * padding them would corrupt them.
 */
export function normaliseCompanyNumber(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim().toUpperCase().replace(/\s+/g, '')
  if (!trimmed) return undefined
  return /^\d+$/.test(trimmed) ? trimmed.padStart(8, '0') : trimmed
}

/** Build a 360Giving org identifier from the most authoritative number we hold. */
function threeSixtyGivingId(charityNumber?: string, companyNumber?: string): string | null {
  if (charityNumber) {
    return charityNumber.toUpperCase().startsWith('SC')
      ? `GB-SC-${charityNumber}`
      : `GB-CHC-${charityNumber}`
  }
  if (companyNumber) return `GB-COH-${companyNumber}`
  return null
}

export interface DueDiligenceResult {
  status: DueDiligenceStatus
  checks: DueDiligenceCheckRecord[]
  checkedAt: string
}

export interface RunOptions {
  fetchers?: DueDiligenceFetchers
  /** Injectable clock for deterministic tests. */
  now?: Date
}

export async function runDueDiligence(
  input: RunDueDiligenceInput,
  opts: RunOptions = {},
): Promise<DueDiligenceResult> {
  const fetchers = opts.fetchers ?? liveFetchers
  const now = opts.now ?? new Date()
  const checkedAt = now.toISOString()

  const charityNumber = input.charityNumber?.trim() || undefined
  const companyNumber = normaliseCompanyNumber(input.companyNumber)
  const ctx: CheckContext = {
    amountRequested: input.amountRequested,
    applicantName: input.organisationName?.trim() || null,
    now,
  }

  // No identifiers at all → there is nothing to screen against, and no amount of
  // re-running will produce one. Reported as its own status rather than `review`: a
  // review is work waiting for a person, and this is not (see DueDiligenceStatus).
  // The application states the gap and offers the only fix — adding a number, which
  // screens on the spot.
  if (!charityNumber && !companyNumber) {
    return { status: 'no_registration', checks: [], checkedAt }
  }

  const checks: DueDiligenceCheckRecord[] = []
  let primaryFailed = false

  // Charity register — OSCR for SC-prefixed numbers, otherwise the Charity
  // Commission (England & Wales) plus the multi-year financial history.
  if (charityNumber) {
    if (charityNumber.toUpperCase().startsWith('SC')) {
      try {
        const raw = await fetchers.oscr(charityNumber)
        checks.push(...oscrChecks(normalizeOscr(raw), ctx))
      } catch {
        primaryFailed = true
      }
    } else {
      try {
        const [raw, history] = await Promise.all([
          fetchers.charityCommission(charityNumber),
          fetchers.charityFinancialHistory(charityNumber),
        ])
        checks.push(...charityChecks(normalizeCharity(raw, history), ctx))
      } catch {
        primaryFailed = true
      }
    }
  }

  // Companies House — runs whenever a company number is present (a charity may
  // be dual-registered, e.g. a charitable company or a CIC with charity status).
  if (companyNumber) {
    try {
      const [raw, filings] = await Promise.all([
        fetchers.companiesHouse(companyNumber),
        fetchers.companiesHouseFilingHistory(companyNumber),
      ])
      checks.push(...companyChecks(normalizeCompany(raw, filings), ctx))
    } catch {
      primaryFailed = true
    }
  }

  // 360Giving runs as a supplementary, info-only check against the best identifier.
  const tsgId = threeSixtyGivingId(charityNumber, companyNumber)
  if (tsgId) {
    try {
      const grants = await fetchers.threeSixtyGiving(tsgId)
      checks.push(...grantHistoryChecks(normalizeGrants(grants), ctx))
    } catch {
      // info-only — ignore
    }
  }

  // A primary register being unreachable means we couldn't actually screen —
  // never auto-pass; surface for manual review (spec §error handling).
  if (primaryFailed) {
    return { status: 'review', checks, checkedAt }
  }

  return { status: computeStatus(checks), checks, checkedAt }
}
