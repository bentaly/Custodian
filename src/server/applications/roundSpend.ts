import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { applications, awardInstalments, awards, roundProgrammes } from '../../../drizzle/schema'
import type { getDb } from '../db'
import type { FinancialYear } from '../../lib/financialYear'
import { resolveFirstYearAmount } from '../../lib/multiYear'

/**
 * What a round-programme has spent of its budget — in THIS YEAR'S CASH, which is what
 * `round_programmes.budget` counts (see `src/lib/multiYear.ts`).
 *
 * ## Why this is one module used by two callers
 *
 * The shortlist's meter and the optional budget ceiling in `updateApplicationStatus` ask
 * the same question, and they have to answer it identically. They did not have to before:
 * both counted the full ask, so two separate sums over two separate sets of rows could
 * not disagree about the basis. On a cash basis they can, and the failure is ugly — the
 * meter says there is room, the admin clicks Shortlist, and the server refuses. Both are
 * behaving as designed and neither is explicable to the person looking at them. So the
 * arithmetic lives here once and is called twice.
 *
 * ## Awarded grants come from their real instalments
 *
 * An application that has been awarded has a schedule, with dates. That schedule IS this
 * year's share and nothing needs estimating — so `applications.first_year_amount` stops
 * being read the moment an award exists. A shortlisted application has no schedule yet,
 * so it contributes its stated-or-suggested figure.
 *
 * Three edges are deliberate:
 *
 * - An award with NO instalments contributes its whole value. An empty schedule is not
 *   "nothing due this year" — it is money committed that nobody has scheduled, and the
 *   Finance panel already calls that out as `unscheduled`. Counting it as zero would
 *   make a round look emptier the less carefully it had been set up.
 * - An instalment with no date counts in THIS year: undated money is owed, and the
 *   conservative placement is the year the grant was decided in.
 * - PAID instalments count. The question here is what this round has charged to the
 *   year's allocation, and money that has gone out has certainly charged it.
 *
 * ## Why the year is bounded at BOTH ends here, and not on the Finance panel
 *
 * A round's budget is an allocation of ONE financial year's cash, so what draws on it is
 * instalments falling INSIDE that year — `dueDate` between `fy.start` and `fy.end`. The
 * Finance panel's `dueByYearEnd` bucket and the annual "already promised" figure are
 * bounded only at the top, on purpose: those answer "what must leave the bank before the
 * year end", where an instalment that fell due last March and was never paid is still
 * owed today. Two questions about the same rows, and the arrears belong in one and not the
 * other. Without the lower bound here, a round from two years ago would see every
 * instalment it ever scheduled fall before today's year end and its meter would creep past
 * its budget on its own.
 *
 * Cancelled grants are excluded, per CLAUDE.md's money rule: a withdrawn grant is not
 * money committed, and a round whose budget stayed consumed by one could never re-spend it.
 */

type Db = ReturnType<typeof getDb>

export type RoundProgrammeSpend = {
  roundProgrammeId: string
  /** This year's cash from grants already awarded against this round-programme. */
  awardedThisYear: number
  /** The full committed value of those grants — shown for context, never metered. */
  awardedFull: number
  /** This year's cash from applications currently shortlisted and not yet awarded. */
  proposedThisYear: number
  /** The full value of those asks — shown beside the drawdown so a board sees both. */
  proposedFull: number
}

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : parseFloat(v)

/**
 * Per-award: this year's scheduled cash and the whole committed value.
 *
 * The instalment totals are a subquery rather than a join, so `amount_awarded` is not
 * fanned out and multiplied by the number of instalments — the same trap
 * `budgetPanelQueries` documents.
 */
function awardedQuery(db: Db, roundProgrammeIds: string[], fy: FinancialYear) {
  const perAward = db
    .select({
      awardId: awardInstalments.awardId,
      thisYear: sql<string>`sum(${awardInstalments.amount}) filter (
        where ${awardInstalments.dueDate} is null
           or (${awardInstalments.dueDate} >= ${fy.start} and ${awardInstalments.dueDate} <= ${fy.end})
      )`.as('this_year'),
      instalments: sql<number>`count(*)`.as('instalments'),
    })
    .from(awardInstalments)
    .groupBy(awardInstalments.awardId)
    .as('per_award')

  return db
    .select({
      roundProgrammeId: applications.roundProgrammeId,
      // An award with no instalment rows contributes its whole value; one whose
      // instalments all fall in later years contributes nothing. `coalesce` alone cannot
      // tell those apart, which is what the instalment count is for.
      thisYear: sql<string>`coalesce(sum(
        case when ${perAward.instalments} is null
             then ${awards.amountAwarded}
             else coalesce(${perAward.thisYear}, 0)
        end
      ), 0)`,
      full: sql<string>`coalesce(sum(${awards.amountAwarded}), 0)`,
    })
    .from(awards)
    .innerJoin(applications, eq(applications.id, awards.applicationId))
    .leftJoin(perAward, eq(perAward.awardId, awards.id))
    .where(
      and(
        inArray(applications.roundProgrammeId, roundProgrammeIds),
        ne(awards.status, 'cancelled'),
      ),
    )
    .groupBy(applications.roundProgrammeId)
}

/**
 * The shortlisted applications not yet awarded, with everything `resolveFirstYearAmount`
 * needs to place each one.
 *
 * Resolved in JS rather than SQL because the suggestion is a rule, not a column, and the
 * meter, the ceiling and the tests must all apply the same one.
 *
 * The left join to `awards` excludes an application that has since been awarded — that
 * one is counted by `awardedQuery` off its real schedule, and counting it here as well
 * would double it.
 */
function proposedQuery(db: Db, roundProgrammeIds: string[], excludeApplicationId?: string) {
  return db
    .select({
      roundProgrammeId: applications.roundProgrammeId,
      amountRequested: applications.amountRequested,
      firstYearAmount: applications.firstYearAmount,
      grantDurationYears: roundProgrammes.grantDurationYears,
    })
    .from(applications)
    .innerJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(
      awards,
      and(eq(awards.applicationId, applications.id), ne(awards.status, 'cancelled')),
    )
    .where(
      and(
        inArray(applications.roundProgrammeId, roundProgrammeIds),
        eq(applications.status, 'shortlisted'),
        isNull(awards.id),
        excludeApplicationId ? ne(applications.id, excludeApplicationId) : undefined,
      ),
    )
}

/**
 * The spend on a set of round-programmes, both halves, on one basis.
 *
 * Two queries in one `db.batch()` — the snapshot property matters here as much as it does
 * on the Finance panel: an award landing between the two halves would be counted twice or
 * not at all, and the figure is metered against a budget.
 *
 * `excludeApplicationId` is how the ceiling asks "what is already spent, apart from the
 * application I am being asked to add".
 */
export async function roundProgrammeSpend(
  db: Db,
  roundProgrammeIds: string[],
  fy: FinancialYear,
  opts: { excludeApplicationId?: string } = {},
): Promise<Map<string, RoundProgrammeSpend>> {
  const out = new Map<string, RoundProgrammeSpend>()
  // `inArray(x, [])` is a SQL error, and an empty scope is a legitimate caller state.
  if (roundProgrammeIds.length === 0) return out

  const row = (id: string): RoundProgrammeSpend => {
    const existing = out.get(id)
    if (existing) return existing
    const fresh: RoundProgrammeSpend = {
      roundProgrammeId: id,
      awardedThisYear: 0,
      awardedFull: 0,
      proposedThisYear: 0,
      proposedFull: 0,
    }
    out.set(id, fresh)
    return fresh
  }

  const [awardedRows, proposedRows] = await db.batch([
    awardedQuery(db, roundProgrammeIds, fy),
    proposedQuery(db, roundProgrammeIds, opts.excludeApplicationId),
  ])

  for (const r of awardedRows) {
    const target = row(r.roundProgrammeId)
    target.awardedThisYear = num(r.thisYear)
    target.awardedFull = num(r.full)
  }
  for (const r of proposedRows) {
    const target = row(r.roundProgrammeId)
    const requested = num(r.amountRequested)
    target.proposedThisYear += resolveFirstYearAmount({
      amountRequested: requested,
      firstYearAmount: r.firstYearAmount === null ? null : num(r.firstYearAmount),
      grantDurationYears: r.grantDurationYears,
    })
    target.proposedFull += requested
  }
  return out
}

/** This year's cash already spent against a round-programme: awarded plus shortlisted. */
export function spentThisYear(spend: RoundProgrammeSpend | undefined): number {
  if (!spend) return 0
  return spend.awardedThisYear + spend.proposedThisYear
}
