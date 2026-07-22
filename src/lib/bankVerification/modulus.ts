// ─── Bank verification: level 1 — modulus check ─────────────────────────────
//
// The cheapest, free-est bank-detail check: is this sort code + account number a
// mathematically valid combination? It catches typos, transposed digits and
// missing/extra digits before an award is paid out. It does NOT confirm the
// account exists or who owns it — that is Confirmation of Payee (level 3), a paid
// per-check API we may add later. This module is the seam that check would slot
// alongside; keep it callable in isolation.
//
// Pure, synchronous, no I/O: the underlying algorithm and its VocaLink weight
// tables run offline inside the Worker (see `uk-modulus-checking.d.ts`). So this
// is free to call on every keystroke/save and trivially testable.
//
// Table freshness caveat: the bundled VocaLink table is a point-in-time snapshot.
// New sort-code ranges (a new fintech) that post-date the snapshot have no rule,
// and the spec deems "no rule" as valid — so a stale table can only ever
// FALSE-PASS a brand-new bank's account, never false-reject a real one. Refresh
// by bumping the `uk-modulus-checking` dependency.

import UkModulusChecking from 'uk-modulus-checking'

export type ModulusCheckStatus =
  // Passed the modulus algorithm, or the sort code has no rule in the table (the
  // VocaLink spec deems that valid). Safe to proceed.
  | 'valid'
  // Correct shape (6-digit sort code, 8-digit account number) but failed the
  // algorithm — almost always a typo. Worth warning on before paying out.
  | 'invalid'
  // Could not run the check because an input was not the right shape. The caller
  // should treat this as a form-validation error, not a bank rejection.
  | 'unchecked'

export type ModulusCheckReason =
  | 'failed_modulus'
  | 'malformed_sort_code'
  | 'malformed_account_number'

export interface ModulusCheckResult {
  status: ModulusCheckStatus
  /** Machine-readable cause; present on every non-`valid` result. */
  reason?: ModulusCheckReason
  /** Digits-only sort code that was checked (6 digits when well-formed). */
  sortCode: string
  /** Digits-only account number that was checked (8 digits when well-formed). */
  accountNumber: string
}

/** Strip everything that isn't a digit — tolerates "08-99-99", "6637 4958", etc. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Validate a UK sort code + account number by modulus checking.
 *
 * Account numbers here must be the standard 8 digits. A handful of banks issue 6-
 * or 7-digit numbers (or building-society roll numbers) that need bank-specific
 * standardisation before checking; that is deliberately out of scope for this
 * first cut and returns `unchecked` / `malformed_account_number`.
 */
export function checkBankAccount(input: {
  sortCode: string
  accountNumber: string
}): ModulusCheckResult {
  const sortCode = digitsOnly(input.sortCode)
  const accountNumber = digitsOnly(input.accountNumber)

  if (sortCode.length !== 6) {
    return { status: 'unchecked', reason: 'malformed_sort_code', sortCode, accountNumber }
  }
  if (accountNumber.length !== 8) {
    return { status: 'unchecked', reason: 'malformed_account_number', sortCode, accountNumber }
  }

  const valid = new UkModulusChecking({ sortCode, accountNumber }).isValid()
  return valid
    ? { status: 'valid', sortCode, accountNumber }
    : { status: 'invalid', reason: 'failed_modulus', sortCode, accountNumber }
}
