// Throwaway helper for building the demo fixture.
//
// Finance runs a level-1 UK modulus check on every grant's bank details and shows the
// result. Random account numbers mostly FAIL that check, which would fill the Finance
// screen with red and make a working feature look broken — so each demo organisation
// needs a sort code / account number pair that genuinely passes.
//
// This brute-forces the first passing account number for each sort code actually used
// in the fixture, using the same checker the app does.
//
// Run: npx tsx scripts/demo/probe-bank.ts

import { checkBankAccount } from '../../src/lib/bankVerification'
import { ORGS } from './lib/data'

/** Stable per-organisation starting point, so the scan yields varied-looking account
 *  numbers instead of a column of near-identical ones — and yields the SAME number on
 *  every run, so re-seeding never silently changes a grant's bank details. */
function seedFor(key: string): number {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return 10_000_000 + (h % 79_000_000)
}

function firstValidAccount(sortCode: string, from: number): string | null {
  for (let i = 0; i < 200_000; i++) {
    const account = String(from + i)
      .padStart(8, '0')
      .slice(-8)
    if (checkBankAccount({ sortCode, accountNumber: account }).status === 'valid') {
      return account
    }
  }
  return null
}

for (const org of ORGS) {
  const sc = org.sortCode.replace(/\D/g, '')
  const account = firstValidAccount(sc, seedFor(org.key))
  console.log(`  ${org.key}: '${account ?? 'NONE'}',`)
}
