import 'dotenv/config'
import { isNull, eq } from 'drizzle-orm'
import { getDb } from '../src/server/db'
import { applications } from '../drizzle/schema'
import { bankStatus } from '../src/lib/bankVerification'

/**
 * Fill in `applications.bank_check_status` for rows written before the column existed.
 *
 * The status is a cache of a pure function of two columns, but the function is the UK
 * modulus algorithm — a weights table, not an expression — so it cannot be a DML
 * migration. Every path that WRITES bank details maintains the column itself (see
 * `server/applications/bank.ts`); this is only for the history.
 *
 * Idempotent: it touches rows where the column is NULL and nothing else, so running it
 * twice is running it once. Safe to run against a live database — no locks beyond the
 * single-row updates.
 *
 *   npx tsx scripts/backfill-bank-check.ts
 *
 * `.env`'s DATABASE_URL points at STAGING. To fill in production, point it at the prod
 * branch for the one run — CI owns prod *migrations*, but this is data, and it has no
 * migration to hang off.
 */
async function main() {
  const db = getDb()
  const rows = await db
    .select({
      id: applications.id,
      bankSortCode: applications.bankSortCode,
      bankAccountNumber: applications.bankAccountNumber,
    })
    .from(applications)
    .where(isNull(applications.bankCheckStatus))

  console.log(`${rows.length} application(s) with no stored bank check`)
  const tally: Record<string, number> = {}
  for (const row of rows) {
    const status = bankStatus(row)
    tally[status] = (tally[status] ?? 0) + 1
    await db
      .update(applications)
      .set({ bankCheckStatus: status })
      .where(eq(applications.id, row.id))
  }
  console.log('done:', tally)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
