// ─── Demo dataset: rounds ────────────────────────────────────────────────────
//
// Two things every script needs about rounds, and neither can come from the fixture's
// names alone.

import { asc, eq } from 'drizzle-orm'
import { getDb } from '../../../src/server/db'
import { rounds } from '../../../drizzle/schema'
import { APPLICATIONS, type DemoAward } from './applications'
import { DEFAULT_FY_END_MONTH, type FinancialYear } from '../../../src/lib/financialYear'
import { roundFinancialYear } from '../../../src/lib/roundYear'
import { NOW, daysFromNow, isoDate } from './shared'
import { OPEN_ROUND, ROUNDS, type DemoRound, type RoundKey } from './data'

/** What a past round with no grant in a programme was given there. */
const UNSPENT_BUDGET = 15_000

/**
 * The tenant's rounds, keyed by fixture key.
 *
 * Matched by CREATION ORDER, never by name. Names are derived from the run day (see
 * `ROUNDS`), so `demo:apply` or `demo:decide` run on a later day can compute a name that
 * is not the one `demo:seed` stored. `demo:seed` inserts rounds one statement at a time in
 * fixture order, so their `created_at` order is the fixture's; opening and closing dates
 * cannot be used instead, because `demo:apply` moves them while it submits.
 */
export async function demoRounds(
  clientId: string,
): Promise<Map<RoundKey, { id: string; name: string }>> {
  const rows = await getDb()
    .select({ id: rounds.id, name: rounds.name })
    .from(rounds)
    .where(eq(rounds.clientId, clientId))
    .orderBy(asc(rounds.createdAt), asc(rounds.id))
  if (rows.length !== ROUNDS.length) {
    throw new Error(
      `Expected ${ROUNDS.length} rounds on the demo tenant, found ${rows.length} — re-run \`pnpm demo:seed\`.`,
    )
  }
  return new Map(ROUNDS.map((r, i) => [r.key, rows[i]!]))
}

/**
 * What a grant pays inside one financial year, split and dated exactly as `demo:decide`
 * writes its instalments (equal shares, the last absorbing the rounding).
 */
function cashInYear(award: DemoAward, fy: FinancialYear): number {
  const count = award.instalments.length
  const per = Math.round((award.amount / count) * 100) / 100
  return award.instalments.reduce((sum, plan, n) => {
    const due = isoDate(daysFromNow(-award.startDaysAgo + plan.daysFromStart))
    if (due < fy.start || due > fy.end) return sum
    return sum + (n === count - 1 ? award.amount - per * (count - 1) : per)
  }, 0)
}

/**
 * A round's programme budgets.
 *
 * The open round's are the fixture's own. A past round's are derived from the grants it
 * actually awarded in each programme — rounded up to the next £5,000 above them with a
 * tenth to spare — because a foundation sets a round's budget close to what it expects to
 * give, and a flat figure made every past round look a third spent.
 *
 * Derived from each grant's FIRST-YEAR CASH, not its whole value: a round-programme budget
 * is an allocation of one financial year (`src/lib/multiYear.ts`), and every screen meters
 * it against the instalments falling inside the round's year (`roundProgrammeSpend`). Sized
 * on whole grants, a round of two-year grants read half spent. A programme a round
 * awarded nothing in keeps a small budget: a round that found nothing worth funding is
 * real, and an empty budget would read as a programme that was never offered.
 */
export function roundBudgets(round: DemoRound): DemoRound['budgets'] {
  if (round.key === OPEN_ROUND) return round.budgets
  const out: DemoRound['budgets'] = {}
  const fy = roundFinancialYear(
    {
      financialYearStart: null,
      openedAt: daysFromNow(-round.openedDaysAgo),
      closedAt: round.closedDaysAgo === null ? null : daysFromNow(-round.closedDaysAgo),
    },
    DEFAULT_FY_END_MONTH,
    NOW,
  )
  for (const [programme, slot] of Object.entries(round.budgets)) {
    const awarded = APPLICATIONS.filter(
      (a) => a.round === round.key && a.programme === programme && a.outcome === 'awarded',
    ).reduce((sum, a) => sum + (a.award ? cashInYear(a.award, fy) : 0), 0)
    out[programme] = {
      ...slot,
      budget: awarded > 0 ? Math.ceil((awarded * 1.1) / 5_000) * 5_000 : UNSPENT_BUDGET,
    }
  }
  return out
}
