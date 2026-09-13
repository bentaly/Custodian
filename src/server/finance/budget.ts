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
  rounds,
  users,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { DEFAULT_FY_END_MONTH, financialYear, type FinancialYear } from '../../lib/financialYear'
import { buildCashFlow, type CashFlow } from '../../lib/cashFlow'
import { buildBalanceSummary, type BalanceSummary } from '../../lib/balanceSummary'
import { getRoundStatus } from '../../lib/roundStatus'
import { addMonthsIso, todayIso } from '../../lib/schedule'
import { roundProgrammeSpend } from '../applications/roundSpend'

/**
 * Finance → Balance & budget: the queries, and their shape for the screen.
 *
 * ## What it is for
 *
 * One question: *after everything this year still has to pay, what is left in the bank?*
 * The cash position comes from `bank_balance_readings` (somebody typing a figure off a
 * statement), the plan from `annual_budgets` + `annual_budget_lines` and this year's round
 * budgets, and the actuals from the same award instalments Finance already lists. The
 * rules live in `src/lib/balanceSummary.ts` (the summary tab) and `src/lib/cashFlow.ts`
 * (the month table); this module fetches and wires.
 *
 * ## The money rule (CLAUDE.md § "The money rule")
 *
 * - **paid** INCLUDES cancelled grants. That money left the building.
 * - **still owed** EXCLUDES them. There is nothing left to pay.
 *
 * Both tabs read ONE instalment query, so the summary's deductions and the cash flow's
 * headroom are the same rows and cannot disagree.
 *
 * ## A grant's year is its ROUND's year
 *
 * "Prior-year" and "this year's" grants are split by `roundFinancialYear`: the year a
 * round's budget is drawn from, which is what the foundation plans by ("the awards we
 * have agreed across the rounds that have happened in this financial year"). The SQL
 * mirrors that rule: a stored start date wins, else the closing date, else the opening
 * date, else today. `getAnnualBudgetSettings` places rounds the same way.
 */

type Db = ReturnType<typeof getDb>

/**
 * How old a balance may be before the screen stops presenting it as current.
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
  /** The Summary tab: what the balance still has to cover, line by line. */
  summary: BalanceSummary
  /** The Cash flow tab: month by month, with the projected balance. */
  cashFlow: CashFlow
  /** Whether the annual budget has core-cost lines, which the cash flow gives a column. */
  hasCoreCosts: boolean
  /** Unpaid instalments with no date: not deducted anywhere, so the screen says so. */
  undated: number
  /** True when there is nothing to show at all. */
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
 * Is this round-programme's budget still open to awards?
 *
 * Upcoming and open rounds are, and so is a closed round with applications still for
 * review or shortlisted — the foundation may yet award up to the ceiling. A closed round
 * with every application decided is not: whatever it did not award is released.
 */
export function roundBudgetHeld(row: {
  openedAt: Date | string | null
  closedAt: Date | string | null
  undecided: string | number
}): boolean {
  return num(row.undecided) > 0 || getRoundStatus(row) !== 'closed'
}

/**
 * The screen, as a plain function of (connection, tenant, today).
 *
 * Split from the server fn for the same reason `financeList` is: everything below the
 * auth check should be runnable without a session.
 *
 * Three round trips. The profile first, because every money query needs the year's bounds
 * as parameters; then the five queries in one `db.batch()`, so all the figures are one
 * snapshot; then `roundProgrammeSpend` for the round budgets still held, because it is the
 * single source for what has been awarded against a round budget and the shortlist meter
 * and the budget ceiling must agree with what this screen calls projected.
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
  const endMonth = profile?.financialYearEndMonth ?? DEFAULT_FY_END_MONTH
  const fy = financialYear(endMonth, now)

  const [balanceRows, budgetRows, instalmentRows, undatedRows, roundRows] = await db.batch(
    budgetPanelQueries(db, clientId, fy),
  )

  const held = roundRows.filter(roundBudgetHeld).map((r) => r.roundProgrammeId)
  const spend = await roundProgrammeSpend(db, held, { financialYearEndMonth: endMonth, now })

  return assemble({
    fy,
    balanceRows,
    budgetRows,
    instalmentRows,
    undatedRows,
    roundRows,
    awardedThisYear: new Map([...spend].map(([id, s]) => [id, s.awardedThisYear])),
  })
}

/**
 * The five queries, as builders.
 *
 * Exported so their SQL can be rendered and asserted without a database — every one of
 * them must filter on `client_id`, and the WHERE must be a plain conjunction. A raw `or`
 * handed to `and()` escapes its own term and re-associates the whole clause, which is
 * how Finance once served every foundation's grants to every other foundation
 * (`query.test.ts` carries that story).
 */
export function budgetPanelQueries(db: Db, clientId: string, fy: FinancialYear) {
  const today = todayIso()
  // How far back PAID instalments are read. A payment only matters before the year for
  // the reading's sake — made after a reading taken before the year began — and a reading
  // older than a year is flagged stale anyway.
  const paidFrom = addMonthsIso(fy.start, -12)

  // The round's financial year, anchored on one date. See the module header.
  const roundYearAnchor = sql`coalesce(
    ${rounds.financialYearStart}::date,
    ${rounds.closedAt}::date,
    ${rounds.openedAt}::date,
    ${today}::date
  )`

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
        lineId: annualBudgetLines.id,
        programmeId: annualBudgetLines.programmeId,
        label: annualBudgetLines.label,
        amount: annualBudgetLines.amount,
        frequency: annualBudgetLines.frequency,
        dueDate: annualBudgetLines.dueDate,
        contingencyPercent: annualBudgets.contingencyPercent,
      })
      .from(annualBudgets)
      .leftJoin(annualBudgetLines, eq(annualBudgetLines.budgetId, annualBudgets.id))
      .where(
        and(
          eq(annualBudgets.clientId, clientId),
          sql`${annualBudgets.financialYearStart} <= ${today}`,
          sql`${annualBudgets.financialYearEnd} >= ${today}`,
        ),
      )
      .orderBy(annualBudgetLines.createdAt),

    // ── Every instalment either tab draws, by programme and round year ───────
    // PAID rows keep cancelled grants (the money left) and reach back to `paidFrom`.
    // UNPAID rows exclude cancelled grants, need a date and stop at the year end: years
    // two and three are not this balance's to pay, and an undated row has no year.
    //
    // Grouped by the round and programme ROWS rather than by the round-year expression:
    // that expression carries bound parameters, and Postgres cannot match a parameterised
    // SELECT expression to a parameterised GROUP BY one. Every round column is
    // functionally dependent on `rounds.id`, so the expression is valid over it.
    //
    // The `or` goes through Drizzle's `or()`, which brackets its own term — see
    // `budget.test.ts` for what a naked one once did to Finance.
    db
      .select({
        programmeId: programmes.id,
        programmeName: programmes.name,
        programmeColour: programmes.colour,
        prior: sql<boolean>`(${roundYearAnchor} < ${fy.start}::date)`,
        day: sql<string>`coalesce(${awardInstalments.paidDate}, ${awardInstalments.dueDate})`,
        paid: sql<boolean>`(${awardInstalments.paidDate} is not null)`,
        amount: sql<string>`sum(${awardInstalments.amount})`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .innerJoin(applications, eq(applications.id, awards.applicationId))
      .innerJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
      .innerJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
      .innerJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
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
        rounds.id,
        programmes.id,
        sql`coalesce(${awardInstalments.paidDate}, ${awardInstalments.dueDate})`,
        sql`(${awardInstalments.paidDate} is not null)`,
      ),

    // ── Unpaid instalments with no date ──────────────────────────────────────
    db
      .select({ undated: sql<string>`coalesce(sum(${awardInstalments.amount}), 0)` })
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .where(
        and(
          eq(awards.clientId, clientId),
          ne(awards.status, 'cancelled'),
          isNull(awardInstalments.paidDate),
          isNull(awardInstalments.dueDate),
        ),
      ),

    // ── This year's round budgets, and whether each is decided ───────────────
    // Archived rounds are out: archiving is "we are done with this", so nothing is held
    // for them. `undecided` counts applications a foundation could still award from.
    db
      .select({
        roundProgrammeId: roundProgrammes.id,
        programmeId: programmes.id,
        programmeName: programmes.name,
        programmeColour: programmes.colour,
        budget: roundProgrammes.budget,
        openedAt: rounds.openedAt,
        closedAt: rounds.closedAt,
        undecided: sql<string>`count(${applications.id}) filter (where ${inArray(applications.status, ['for_review', 'shortlisted'])})`,
      })
      .from(roundProgrammes)
      .innerJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
      .innerJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
      .leftJoin(applications, eq(applications.roundProgrammeId, roundProgrammes.id))
      .where(
        and(
          eq(rounds.clientId, clientId),
          isNull(rounds.archivedAt),
          sql`${roundYearAnchor} between ${fy.start}::date and ${fy.end}::date`,
        ),
      )
      .groupBy(roundProgrammes.id, rounds.id, programmes.id),
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

type Rows<I extends number> = Awaited<ReturnType<typeof budgetPanelQueries>[I]>

/** Shape the result sets into what the screen draws. Pure; the rules are in the libs. */
export function assemble(input: {
  fy: FinancialYear
  balanceRows: Rows<0>
  budgetRows: Rows<1>
  instalmentRows: Rows<2>
  undatedRows: Rows<3>
  roundRows: Rows<4>
  /** `roundProgrammeSpend(...).awardedThisYear`, for the held round-programmes. */
  awardedThisYear: Map<string, number>
}): BalanceAndBudget {
  const { fy } = input
  const today = todayIso()

  const b = input.balanceRows[0]
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

  // A budget is only a budget if it has lines. The LEFT JOIN yields one row of nulls for
  // a header with none, and `saveAnnualBudget` deletes the header when the last line goes
  // — but a row written before that, or by anything else, must not draw an empty budget.
  const lines = input.budgetRows.filter((r) => r.lineId)
  const hasBudget = lines.length > 0
  const costLines = lines
    .filter((r) => !r.programmeId)
    .map((r) => ({
      label: r.label,
      amount: num(r.amount),
      frequency: r.frequency,
      dueDate: r.dueDate,
    }))

  const instalments = input.instalmentRows.map((r) => ({
    programmeId: r.programmeId,
    programmeName: r.programmeName,
    programmeColour: r.programmeColour,
    prior: r.prior === true,
    day: r.day,
    paid: r.paid === true,
    amount: num(r.amount),
  }))
  const balanceAt = balance ? { amount: balance.amount, asAtDate: balance.asAtDate } : null

  const summary = buildBalanceSummary({
    fy,
    today,
    balance: balanceAt,
    costLines,
    instalments,
    roundProgrammes: input.roundRows.map((r) => ({
      programmeId: r.programmeId,
      programmeName: r.programmeName,
      programmeColour: r.programmeColour,
      budget: num(r.budget),
      awardedThisYear: input.awardedThisYear.get(r.roundProgrammeId) ?? 0,
      held: roundBudgetHeld(r),
    })),
    programmeBudgets: new Map(
      lines.filter((r) => r.programmeId).map((r) => [r.programmeId!, num(r.amount)]),
    ),
    contingencyPercent:
      hasBudget && input.budgetRows[0]?.contingencyPercent != null
        ? num(input.budgetRows[0].contingencyPercent)
        : null,
  })

  // Placed in the CURRENT year's bounds, like everything else on this screen.
  const cashFlow = buildCashFlow({
    fy,
    today,
    balance: balanceAt,
    instalments: instalments.map((i) => ({ day: i.day, paid: i.paid, amount: i.amount })),
    costLines,
  })

  return {
    financialYear: fy,
    balance,
    summary,
    cashFlow,
    hasCoreCosts: costLines.length > 0,
    undated: num(input.undatedRows[0]?.undated),
    empty: !balance && !hasBudget && summary.lines.length === 0,
  }
}
