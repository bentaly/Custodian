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
  amountRequested: number
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
  const companyNumber = input.companyNumber?.trim() || undefined
  const ctx: CheckContext = { amountRequested: input.amountRequested, now }

  // No identifiers at all → can't screen automatically; block for manual
  // clarification (spec §routing).
  if (!charityNumber && !companyNumber) {
    return { status: 'review', checks: [], checkedAt }
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
      checks.push(...grantHistoryChecks(normalizeGrants(grants)))
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
