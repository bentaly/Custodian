import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
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
import { rollUpCash } from '../../lib/multiYear'
import { scheduleCoreCosts, type CoreCostRollup } from '../../lib/coreCosts'
import { buildCashFlow, type CashFlow } from '../../lib/cashFlow'
import { addMonthsIso, todayIso } from '../../lib/schedule'

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
  /** The same year counted in this year's cash rather than in commitments. NULL with no budget. */
  cash: ReturnType<typeof rollUpCash> | null
  outstanding: OutstandingSplit
  /** The non-grant lines placed through the year. NULL with no budget or no such lines. */
  coreCosts: CoreCostRollup | null
  /** Month by month, with the projected balance and the headroom it ends on. */
  cashFlow: CashFlow
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
 * parameters — so the profile is read first and the six money queries then go in one
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

  const [
    balanceRows,
    budgetRows,
    actualRows,
    outstandingRows,
    cashRows,
    bucketRows,
    instalmentDayRows,
  ] = await db.batch(budgetPanelQueries(db, clientId, fy))
  return assemble(
    fy,
    balanceRows,
    budgetRows,
    actualRows,
    outstandingRows,
    cashRows,
    bucketRows,
    instalmentDayRows,
  )
}

/**
 * The seven money queries, as builders.
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
  // How far back the cash flow reads PAID instalments. See the last query.
  const paidFrom = addMonthsIso(fy.start, -12)

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
        carriedCommitment: annualBudgetLines.carriedCommitment,
        frequency: annualBudgetLines.frequency,
        dueDate: annualBudgetLines.dueDate,
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

    // ── The cash view: what this year must actually PAY, per programme ───────
    //
    // Two filtered sums over one scan, because they are the same money split by when the
    // decision was taken: `promised` is cash owed this year against grants decided in
    // EARLIER years (the figure a foundation cannot otherwise see when it sets a new
    // round's budget), and `drawnThisYear` is cash owed this year against grants decided
    // in THIS one. Together they are this year's grant cash; `committed` in the rollup
    // above is the same decisions counted at their full multi-year value, which is the
    // accounts figure. The screen prints both and says where they differ.
    //
    // Bounded exactly like the `dueByYearEnd` bucket below — no lower bound, undated
    // included — because they are the same money seen two ways, and a reader adding the
    // per-programme lines up has to arrive at the total.
    db
      .select({
        programmeId: roundProgrammes.programmeId,
        promised: sql<string>`coalesce(sum(${awardInstalments.amount}) filter (
          where ${awards.decisionAt} < ${fy.start}::date
        ), 0)`,
        drawnThisYear: sql<string>`coalesce(sum(${awardInstalments.amount}) filter (
          where ${awards.decisionAt} >= ${fy.start}::date
        ), 0)`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .innerJoin(applications, eq(applications.id, awards.applicationId))
      .innerJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
      .where(
        and(
          eq(awards.clientId, clientId),
          ne(awards.status, 'cancelled'),
          sql`${awardInstalments.paidDate} is null`,
          sql`(${awardInstalments.dueDate} is null or ${awardInstalments.dueDate} <= ${fy.end})`,
        ),
      )
      .groupBy(roundProgrammes.programmeId),

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

    // ── Every instalment the cash flow draws, by day ─────────────────────────
    // `buildCashFlow` (`src/lib/cashFlow.ts`) places these in months and projects the
    // balance from them. PAID rows keep cancelled grants (the money left) and reach back
    // a year before the year starts — far enough to catch a payment made after a reading
    // taken before the year began; a reading older than that is flagged stale anyway.
    // UNPAID rows exclude cancelled grants, need a date and stop at the year end, which is
    // exactly the `dueByYearEnd` bucket above, so the projection and it are the same money.
    //
    // The `or` goes through Drizzle's `or()`, which brackets its own term — see
    // `budget.test.ts` for what a naked one once did to Finance.
    db
      .select({
        day: sql<string>`coalesce(${awardInstalments.paidDate}, ${awardInstalments.dueDate})`,
        paid: sql<boolean>`(${awardInstalments.paidDate} is not null)`,
        amount: sql<string>`sum(${awardInstalments.amount})`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .where(
        and(
          eq(awards.clientId, clientId),
          or(
            and(isNotNull(awardInstalments.paidDate), gte(awardInstalments.paidDate, paidFrom)),
            and(
              isNull(awardInstalments.paidDate),
              ne(awards.status, 'cancelled'),
              isNotNull(awardInstalments.dueDate),
              lte(awardInstalments.dueDate, fy.end),
            ),
          ),
        ),
      )
      .groupBy(
        sql`coalesce(${awardInstalments.paidDate}, ${awardInstalments.dueDate})`,
        sql`(${awardInstalments.paidDate} is not null)`,
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
export function assemble(
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
    carriedCommitment: string | null
    frequency: string | null
    dueDate: string | null
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
  cashRows: { programmeId: string; promised: string; drawnThisYear: string }[],
  bucketRows: { dueByYearEnd: string; dueLater: string; undated: string }[],
  instalmentDayRows: { day: string; paid: boolean; amount: string }[],
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

  // ── The cash view, beside the commitment one ───────────────────────────────
  //
  // `rollUpBudget` above answers "are we spending the year the way we planned", counted
  // in DECISIONS at their full multi-year value, which is the accounts basis and is
  // unchanged. This answers "what does this year actually have to pay, and what is left
  // free to give" — the question a foundation cannot otherwise ask, and the basis a round
  // budget is set in. Printing both is the point: where they differ, the difference is a
  // real fact about multi-year giving rather than a discrepancy to reconcile away.
  const cash = hasBudget
    ? rollUpCash(
        budgetRows
          .filter((r) => r.lineId)
          .map((r) => ({
            programmeId: r.programmeId,
            amount: num(r.amount),
            carriedCommitment: r.carriedCommitment === null ? null : num(r.carriedCommitment),
          })),
        new Map(
          budgetRows
            .filter((r) => r.programmeId && r.programmeName)
            .map((r) => [r.programmeId!, { name: r.programmeName!, colour: r.programmeColour }]),
        ),
        new Map(cashRows.map((r) => [r.programmeId, num(r.promised)])),
        // Allocation to rounds is NOT shown here. It is a planning figure and it belongs
        // on the screen where the budget is set; this screen is about money owed, and the
        // figure it wants beside "free to give" is what has actually been drawn.
        new Map(cashRows.map((r) => [r.programmeId, num(r.drawnThisYear)])),
      )
    : null

  // ── Core costs, and the year month by month ────────────────────────────────
  //
  // Placed in the CURRENT year's bounds, like everything else on this screen. The budget
  // row was found by containing today, so its stored bounds are this year's — except after
  // a year-end change, when the months on screen are still the ones to place it into.
  const costLines = budgetRows
    .filter((r) => r.lineId && !r.programmeId)
    .map((r) => ({
      label: r.label,
      amount: num(r.amount),
      frequency: r.frequency,
      dueDate: r.dueDate,
    }))
  const coreCosts = costLines.length > 0 ? scheduleCoreCosts(costLines, fy, today) : null
  const cashFlow = buildCashFlow({
    fy,
    today,
    balance: balance ? { amount: balance.amount, asAtDate: balance.asAtDate } : null,
    instalments: instalmentDayRows.map((r) => ({
      day: r.day,
      paid: r.paid === true,
      amount: num(r.amount),
    })),
    costLines,
  })

  return {
    financialYear: fy,
    balance,
    coreCosts,
    cashFlow,
    budget: hasBudget ? { ...rollup, label: budgetRows[0]?.budgetLabel ?? fy.label } : null,
    /**
     * The same year on a cash basis. `allocated` on each line is what grants decided THIS
     * year owe this year — the drawdown, not a round allocation.
     */
    cash,
    outstanding,
    empty: !balance && !hasBudget,
  }
}
