/**
 * One-off: transcribe Vibe's uploaded budget spreadsheet into
 * `applications.budget_breakdown`.
 *
 *   pnpm tsx scripts/backfill-vibe-budget.ts          # dry run
 *   pnpm tsx scripts/backfill-vibe-budget.ts --apply
 *
 * WHY BY HAND. Nothing in Custodian reads a spreadsheet. `budgetBreakdownLink`
 * holds the applicant's uploaded FILE; `budgetBreakdown` holds structured
 * `BudgetLine[]`, and it is only ever populated when the submission payload
 * already carries a structured budget field. Arete's other applications have
 * both because their payloads arrived with a separate "Budget breakdown" key —
 * Vibe's arrived with the file link alone, so there was nothing to parse.
 *
 * Figures below are transcribed from `45. Arete costing template.xlsx` (sheet
 * "45. Arete"). Only LEAF lines are kept — the sheet's section subtotals
 * (11,581.52 / 3,840 / 2,313.24) and its 17,734.76 total would double-count.
 * The leaves sum to that total; `verify` below re-checks it before writing.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import * as schema from '../drizzle/schema'
import { applications } from '../drizzle/schema'
import type { BudgetLine } from '../src/lib/budget/types'

const APPLICATION_ID = 'bf15e484-9cd8-4ac2-86e4-1e3b11d4039c'
const SHEET_TOTAL = 17734.76

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

const line = (item: string, amount: number, section: string, note?: string): BudgetLine => ({
  item,
  amount,
  details: [
    { label: 'Section', value: section },
    ...(note ? [{ label: 'Basis', value: note }] : []),
  ],
})

const STAFF = 'Delivery staffing costs'
const DELIVERY = 'Delivery costs'
const OVERHEAD = 'Admin overhead'

const BUDGET: BudgetLine[] = [
  line('Lead Youth Worker', 3648.6, STAFF),
  line('Youth Support Workers', 2623.6, STAFF),
  line('Area Manager', 1847.3, STAFF),
  line('Head of / SMT / Director', 3462.02, STAFF),
  line('Resources & equipment', 1000, DELIVERY),
  line('Provisions, certificates and additional support', 100, DELIVERY),
  line('Activity costs — ASB / knife crime equipment', 800, DELIVERY),
  line('ALP training', 900, DELIVERY),
  line('Transport & travel — general', 540, DELIVERY),
  line('One-off trips', 500, DELIVERY),
  line(
    'Insurance, health & safety, ICT, licences',
    771.08,
    OVERHEAD,
    '5% of costs before overheads',
  ),
  line('Marketing & comms', 771.08, OVERHEAD, '5% of costs before overheads'),
  line('Essential training for staff team', 771.08, OVERHEAD, '5% of costs before overheads'),
]

function verify() {
  const sum = Number(BUDGET.reduce((t, l) => t + l.amount, 0).toFixed(2))
  if (Math.abs(sum - SHEET_TOTAL) > 0.005) {
    throw new Error(`transcription does not reconcile: ${sum} vs sheet total ${SHEET_TOTAL}`)
  }
  return sum
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sum = verify()

  const existing = await db.query.applications.findFirst({
    where: (a, { eq }) => eq(a.id, APPLICATION_ID),
    columns: {
      organisationName: true,
      budgetBreakdown: true,
      budgetBreakdownLink: true,
      amountRequested: true,
    },
  })
  if (!existing) throw new Error(`application ${APPLICATION_ID} not found`)

  console.log(`${existing.organisationName}`)
  console.log(`  asking:   £${Number(existing.amountRequested).toLocaleString('en-GB')}`)
  console.log(`  file:     ${existing.budgetBreakdownLink}`)
  console.log(
    `  current:  ${existing.budgetBreakdown ? `${(existing.budgetBreakdown as BudgetLine[]).length} lines` : 'null'}`,
  )
  console.log(
    `\n  ${BUDGET.length} lines totalling £${sum.toLocaleString('en-GB')} (sheet says £${SHEET_TOTAL.toLocaleString('en-GB')}):`,
  )
  for (const l of BUDGET) {
    console.log(
      `    ${l.item.padEnd(50)} £${l.amount.toFixed(2).padStart(9)}   ${l.details?.[0]?.value}`,
    )
  }

  if (existing.budgetBreakdown) {
    console.log('\nRefusing to overwrite a breakdown that is already there.')
    return
  }
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  await db
    .update(applications)
    .set({ budgetBreakdown: BUDGET })
    .where(eq(applications.id, APPLICATION_ID))
  console.log('\nWritten.')
}

main().then(() => process.exit(0))
