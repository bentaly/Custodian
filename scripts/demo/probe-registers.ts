// Throwaway verification helper for building the demo fixture.
//
// Due diligence screens by registration NUMBER, so every number baked into the demo
// dataset has to be one the live registers actually recognise — a made-up number
// returns "Registration number not found" and the whole DD panel reads as broken.
// This prints verified charity/company pairs, plus each charity's latest income, so
// the fixture can pair a plausible ask with a charity of a plausible size.
//
// Run: npx tsx scripts/demo/probe-registers.ts

import 'dotenv/config'
import { liveFetchers } from '../../src/server/dueDiligence/fetchers'

const CHARITY_CANDIDATES = [
  '202918',
  '216250',
  '216401',
  '263710',
  '219830',
  '1128267',
  '208231',
  '207076',
  '294344',
  '1110522',
  '219432',
  '261017',
  '220949',
  '213890',
  '207994',
  '1052076',
  '1082947',
  '292411',
  '212810',
  '291558',
  '1146792',
  '205846',
  '1081247',
  '284934',
  '296645',
]

async function main() {
  const rows: string[] = []
  for (const n of CHARITY_CANDIDATES) {
    try {
      const raw = (await liveFetchers.charityCommission(n)) as Record<string, unknown> | null
      if (!raw) {
        rows.push(`${n} | CHARITY NOT FOUND`)
        continue
      }
      const co = String(raw['charity_co_reg_number'] ?? '').trim()
      const income = raw['latest_income']
      const status = raw['reg_status']

      // The charity register stores company numbers unpadded ("612172"); Companies
      // House wants the canonical 8-character form ("00612172"). Prefixed numbers
      // (RC…, SC…, NI…) are already canonical and must not be padded.
      const padded = /^\d+$/.test(co) ? co.padStart(8, '0') : co

      let coStatus = '(none on register)'
      if (co) {
        try {
          const c = (await liveFetchers.companiesHouse(padded)) as Record<string, unknown> | null
          coStatus = c ? `${c['company_status']}` : 'CH NOT FOUND'
        } catch (e) {
          coStatus = `CH ERROR ${String(e)}`
        }
      }
      rows.push(`${n} | ${status} | income ${income} | company ${padded || '—'} | ${coStatus}`)
    } catch (e) {
      rows.push(`${n} | ERROR ${String(e)}`)
    }
  }
  console.log('charity | status | income | company | company status')
  for (const r of rows) console.log(r)
}

main().then(() => process.exit(0))
