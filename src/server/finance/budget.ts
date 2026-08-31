import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  annualBudgetLines,
  annualBudgets,
  applications,
  awardInstalments,
  awards,
  bankBalanceReadings,
  programmes,
  roundProgrammes,
  users,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { DEFAULT_FY_END_MONTH, financialYear, type FinancialYear } from '../../lib/financialYear'
import {
  rollUpBudget,
  splitOutstanding,
  type BudgetRollup,
  type OutstandingSplit,
} from '../../lib/annualBudget'
import { todayIso } from '../../lib/schedule'

/**
 * "Bank balance & budget" — the panel at the head of the Finance screen.
 *
 * ## What it is for
 *
 * One question, asked with two numbers a foundation cannot otherwise put side by side:
 * *can we cover what we have promised, and are we spending the year the way we planned?*
 * The cash position comes from `bank_balance_readings` (somebody typing a figure off a
 * statement), the plan from `annual_budgets` + `annual_budget_lines`, and the actuals
 * from the same awards Finance already lists.
 *
 * ## The money rule, extended (CLAUDE.md § "The money rule")
 *
 * This is the SIXTH module computing committed / paid / outstanding, and the first to
 * print them next to a bank balance — which is the most reconciliation-sensitive thing
 * in the app, because a head of finance reads it against their own ledger. The existing
 * rule is followed exactly:
 *
 * - **paid** INCLUDES cancelled grants. That money left the building.
 * - **committed** and **outstanding** EXCLUDE them. Nothing left to pay.
 *
 * Which raises a case the rule did not have to answer before, because nothing put the
 * two in one bar: a grant cancelled *after* a part-payment has paid money that
 * `committed` no longer counts, so `committed - paid` can go negative and the meter
 * would draw backwards. The budget answer is `budgetUsed = max(committed, paid)` —
 * what this year's allocation no longer has, whichever way the money left. In the
 * ordinary case (no cancellations) committed ≥ paid and it is simply `committed`, which
 * is why the arithmetic on screen still reconciles against Finance's own totals.
 *
 * ## Two definitions of "committed", and which one this is
 *
 * The dashboard's round meters count `shortlisted` OR `awarded` — the pipeline, because
 * that panel is about a round filling up. Finance counts awarded-and-not-cancelled —
 * decisions, because that panel is about money owed. **This is Finance's**: an annual
 * budget is consumed by decisions, not by applications under consideration, and a bar
 * that moved when somebody shortlisted an application would tell a trustee they had
 * spent money they had not committed. The two meters look alike on purpose and count
 * different things on purpose; the labels must not blur them.
 *
 * ## Why the year is a cohort, not a cash window
 *
 * `committed` and `paid` here are both about **awards DECIDED in this financial year**,
 * not payments that happened to move during it. That is how grant budgets work and how
 * charity SORP recognises a multi-year grant: the whole commitment lands in the year the
 * obligation arises, and years two and three are cash-flow, not budget. So a three-year
 * £90,000 grant consumes £90,000 of this year's budget and appears in `outstanding` for
 * years afterwards — which is exactly why `outstanding` is bucketed by due date below
 * rather than set whole against a bank balance it will never be paid from.
 */

type Db = ReturnType<typeof getDb>

/**
 * How old a balance may be before the panel stops presenting it as current.
 *
 * A grant-making account is not a current account — there is no daily spend on it, so
 * foundations update this quarterly at best, and a 30-day warning would be lit almost
 * permanently and therefore ignored. 120 days is a quarter plus a month of grace: it
 * only lights up when a reading has genuinely been skipped.
 */
export const BALANCE_STALE_DAYS = 120

export type BankBalance = {
  amount: number
  /** The date the balance was true — not when it was typed. */
  asAtDate: string
  note: string | null
  recordedBy: string | null
  /** Whole days between `asAtDate` and today. Negative is impossible; the input is capped. */
  daysOld: number
  stale: boolean
}

export type BalanceAndBudget = {
  financialYear: FinancialYear
  balance: BankBalance | null
  /** NULL when this foundation has set no budget for the year — the panel then shows only cash. */
  budget: (BudgetRollup & { label: string }) | null
  outstanding: OutstandingSplit
  /** True when there is nothing to show at all, so the caller can render no panel. */
  empty: boolean
}

/** Whole days from an ISO day to today, floored at 0 — a future as-at date is not "negative old". */
function daysSince(iso: string, today: string): number {
  const ms = new Date(`${today}T00:00:00Z`).getTime() - new Date(`${iso}T00:00:00Z`).getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
}

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : parseFloat(v)

/**
 * The panel, as a plain function of (connection, tenant, today).
 *
 * Split from the server fn for the same reason `financeList` is: everything below the
 * auth check should be runnable without a session.
 *
 * Two round trips, not one. The financial year is derived from
 * `client_profiles.financial_year_end_month`, and every money query needs its bounds as
 * parameters — so the profile is read first and the five money queries then go in one
 * `db.batch()`. The snapshot property that matters is preserved: all the FIGURES come
 * from one batch, so no payment can land between the meter and the total beneath it.
 * Only the year-end month, which changes approximately never, is read separately.
 */
export async function balanceAndBudget(
  db: Db,
  clientId: string,
  now: Date = new Date(),
): Promise<BalanceAndBudget> {
  const profile = await db.query.clientProfiles.findFirst({
    where: (p, { eq: e }) => e(p.clientId, clientId),
    columns: { financialYearEndMonth: true },
  })
  const fy = financialYear(profile?.financialYearEndMonth ?? DEFAULT_FY_END_MONTH, now)

  const [balanceRows, budgetRows, actualRows, outstandingRows, bucketRows] = await db.batch(
    budgetPanelQueries(db, clientId, fy),
  )
  return assemble(fy, balanceRows, budgetRows, actualRows, outstandingRows, bucketRows)
}

/**
 * The five money queries, as builders.
 *
 * Exported so their SQL can be rendered and asserted without a database — every one of
 * them must filter on `client_id`, and the WHERE must be a plain conjunction. A raw `or`
 * handed to `and()` escapes its own term and re-associates the whole clause, which is
 * how Finance once served every foundation's grants to every other foundation
 * (`query.test.ts` carries that story). Nothing here is scoped any other way, so the
 * check is cheap and the property is exactly the one that matters.
 */
export function budgetPanelQueries(db: Db, clientId: string, fy: FinancialYear) {
  const today = todayIso()

  // `decision_at` is a timestamp and the year bounds are dates, so the upper bound is
  // exclusive-of-the-next-day rather than `<= end` — an award decided at 14:00 on the
  // last day of the year belongs to that year.
  const inYear = and(
    sql`${awards.decisionAt} >= ${fy.start}::date`,
    sql`${awards.decisionAt} < (${fy.end}::date + 1)`,
  )

  // One row per award: what has actually been paid on it. Kept as a subquery rather than
  // a join to the instalment rows, which would fan the award out and multiply
  // `amount_awarded` into every sum that touches it.
  const paidPerAward = db
    .select({
      awardId: awardInstalments.awardId,
      paid: sql<string>`sum(${awardInstalments.amount})`.as('paid'),
    })
    .from(awardInstalments)
    .where(sql`${awardInstalments.paidDate} is not null`)
    .groupBy(awardInstalments.awardId)
    .as('paid_per_award')

  return [
    // ── The cash position: the most recent reading ───────────────────────────
    // Ordered by the date the balance was TRUE, then by when it was entered, so a
    // correction typed later for the same day wins over the figure it corrects.
    db
      .select({
        amount: bankBalanceReadings.amount,
        asAtDate: bankBalanceReadings.asAtDate,
        note: bankBalanceReadings.note,
        recordedBy: users.name,
      })
      .from(bankBalanceReadings)
      .leftJoin(users, eq(users.id, bankBalanceReadings.recordedByUserId))
      .where(eq(bankBalanceReadings.clientId, clientId))
      .orderBy(sql`${bankBalanceReadings.asAtDate} desc, ${bankBalanceReadings.createdAt} desc`)
      .limit(1),

    // ── The plan: this year's budget and its lines ───────────────────────────
    // Located by date containment rather than by recomputing the year from the profile,
    // so a budget set under a previous year-end setting is still found under its own
    // dates instead of quietly disappearing.
    db
      .select({
        budgetLabel: annualBudgets.label,
        lineId: annualBudgetLines.id,
        programmeId: annualBudgetLines.programmeId,
        label: annualBudgetLines.label,
        amount: annualBudgetLines.amount,
        programmeName: programmes.name,
        programmeColour: programmes.colour,
      })
      .from(annualBudgets)
      .leftJoin(annualBudgetLines, eq(annualBudgetLines.budgetId, annualBudgets.id))
      .leftJoin(programmes, eq(programmes.id, annualBudgetLines.programmeId))
      .where(
        and(
          eq(annualBudgets.clientId, clientId),
          sql`${annualBudgets.financialYearStart} <= ${today}`,
          sql`${annualBudgets.financialYearEnd} >= ${today}`,
        ),
      ),

    // ── The actuals: awards decided in this year, by programme ───────────────
    db
      .select({
        programmeId: roundProgrammes.programmeId,
        programmeName: programmes.name,
        programmeColour: programmes.colour,
        // Committed excludes cancelled; paid does not. See the module header.
        committed: sql<string>`coalesce(sum(${awards.amountAwarded}) filter (where ${awards.status} <> 'cancelled'), 0)`,
        paid: sql<string>`coalesce(sum(${paidPerAward.paid}), 0)`,
      })
      .from(awards)
      .innerJoin(applications, eq(applications.id, awards.applicationId))
      .innerJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
      .innerJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
      .leftJoin(paidPerAward, eq(paidPerAward.awardId, awards.id))
      .where(and(eq(awards.clientId, clientId), inYear))
      .groupBy(roundProgrammes.programmeId, programmes.name, programmes.colour),

    // ── What is still owed, in total ─────────────────────────────────────────
    // Measured against what was COMMITTED, not against the instalment plan — the same
    // definition as Finance's `outstanding` column, so the two cannot disagree. Note
    // this is portfolio-wide and NOT limited to the year: a grant awarded two years ago
    // still owes its final instalment out of today's bank balance.
    db
      .select({
        total: sql<string>`coalesce(sum(${awards.amountAwarded}), 0) - coalesce(sum(${paidPerAward.paid}), 0)`,
      })
      .from(awards)
      .leftJoin(paidPerAward, eq(paidPerAward.awardId, awards.id))
      .where(and(eq(awards.clientId, clientId), ne(awards.status, 'cancelled'))),

    // ── …and when it falls due ───────────────────────────────────────────────
    // The whole reason the panel does not set a bank balance against total outstanding:
    // years two and three of a multi-year grant are not paid from today's cash.
    db
      .select({
        dueByYearEnd: sql<string>`coalesce(sum(${awardInstalments.amount}) filter (where ${awardInstalments.dueDate} is not null and ${awardInstalments.dueDate} <= ${fy.end}), 0)`,
        dueLater: sql<string>`coalesce(sum(${awardInstalments.amount}) filter (where ${awardInstalments.dueDate} > ${fy.end}), 0)`,
        undated: sql<string>`coalesce(sum(${awardInstalments.amount}) filter (where ${awardInstalments.dueDate} is null), 0)`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .where(
        and(
          eq(awards.clientId, clientId),
          ne(awards.status, 'cancelled'),
          sql`${awardInstalments.paidDate} is null`,
        ),
      ),
  ] as const
}

/**
 * The programmes of one tenant, out of a set of ids — the ownership check `saveAnnualBudget`
 * runs before it writes a budget line.
 *
 * Here rather than inline in the server fn so its SQL can be rendered without a session.
 * It was written first as a raw ``sql`${programmes.id} = any(${ids})` ``, which typechecks
 * and then fails at runtime: Drizzle expands a JS array inside an `sql` template into a
 * parameter LIST, so Postgres sees `any(($2, $3, $4))` and answers "op ANY/ALL (array)
 * requires array on right side". `inArray` builds the `in (...)` this actually wants.
 */
export function ownedProgrammes(db: Db, clientId: string, ids: string[]) {
  return db
    .select({ id: programmes.id })
    .from(programmes)
    .where(and(eq(programmes.clientId, clientId), inArray(programmes.id, ids)))
}

/** Shape the five result sets into what the panel draws. Pure; see `src/lib/annualBudget.ts`. */
function assemble(
  fy: FinancialYear,
  balanceRows: {
    amount: string
    asAtDate: string
    note: string | null
    recordedBy: string | null
  }[],
  budgetRows: {
    budgetLabel: string
    lineId: string | null
    programmeId: string | null
    label: string | null
    amount: string | null
    programmeName: string | null
    programmeColour: string | null
  }[],
  actualRows: {
    programmeId: string
    programmeName: string
    programmeColour: string | null
    committed: string
    paid: string
  }[],
  outstandingRows: { total: string }[],
  bucketRows: { dueByYearEnd: string; dueLater: string; undated: string }[],
): BalanceAndBudget {
  const today = todayIso()

  // ── Cash ───────────────────────────────────────────────────────────────────
  const b = balanceRows[0]
  const balance: BankBalance | null = b
    ? {
        amount: num(b.amount),
        asAtDate: b.asAtDate,
        note: b.note,
        recordedBy: b.recordedBy,
        daysOld: daysSince(b.asAtDate, today),
        stale: daysSince(b.asAtDate, today) > BALANCE_STALE_DAYS,
      }
    : null

  // ── Outstanding ────────────────────────────────────────────────────────────
  const bucket = bucketRows[0]
  const outstanding = splitOutstanding(num(outstandingRows[0]?.total), {
    dueByYearEnd: num(bucket?.dueByYearEnd),
    dueLater: num(bucket?.dueLater),
    undated: num(bucket?.undated),
  })

  // ── The plan against the actuals ───────────────────────────────────────────
  //
  // A budget is only a budget if it has lines. The LEFT JOIN yields one row of nulls for
  // a header with none, and counting that as a budget drew "£0 of £0" with no meters —
  // `saveAnnualBudget` now deletes the header when the last line goes, but a row written
  // before that, or by anything else, must not be able to produce that screen either.
  const hasBudget = budgetRows.some((r) => r.lineId)
  const rollup = rollUpBudget(
    budgetRows
      .filter((r) => r.lineId)
      .map((r) => ({
        programmeId: r.programmeId,
        label: r.label,
        amount: num(r.amount),
      })),
    actualRows.map((r) => ({
      programmeId: r.programmeId,
      name: r.programmeName,
      colour: r.programmeColour,
      committed: num(r.committed),
      paid: num(r.paid),
    })),
    new Map(
      budgetRows
        .filter((r) => r.programmeId && r.programmeName)
        .map((r) => [r.programmeId!, { name: r.programmeName!, colour: r.programmeColour }]),
    ),
  )

  return {
    financialYear: fy,
    balance,
    budget: hasBudget ? { ...rollup, label: budgetRows[0]?.budgetLabel ?? fy.label } : null,
    outstanding,
    empty: !balance && !hasBudget,
  }
}
