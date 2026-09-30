import { CORE_COSTS_LABEL } from './annualBudget'
import { INCOME_LABEL, costEntries, round2, type CostLineInput } from './coreCosts'

/**
 * The Balance & budget summary: what this financial year has spent, plans to, and still
 * owes, line by line — and what is left in the bank once all of it has gone.
 *
 * ## The lines
 *
 * - **Core costs**: the non-grant budget lines, placed by `costEntries`.
 * - **Prior-year committed grants**: this year's instalments on grants from rounds that
 *   belong to an EARLIER financial year (`roundFinancialYear`).
 * - **This year's grant spend**: this year's instalments on grants from this year's rounds,
 *   plus what is still projected out of this year's round budgets.
 * - **Contingency**: a percentage of the grant budget (the programme lines).
 * - **Income**: the budget's income lines, placed by `costEntries` like core costs. The
 *   one line that is money IN. Actual is what the plan says has arrived by today,
 *   Projected what is still to come; Still to pay does not apply. It is in `lines`, last,
 *   and deliberately NOT in `total`, which stays money out so the footer can be checked
 *   by subtraction: money out, money in, and the net.
 *
 * Grant lines break down by programme and core costs by their own labels. A parent is the
 * sum of its children and nothing else, so a breakdown cannot drift from its headline.
 *
 * ## The three figures (agreed 2026-09-13)
 *
 * The screen no longer shows these as columns: since 2026-09-30 it derives Fixed |
 * Projected and To date | To come from them (`fourWay` in `BalanceAndBudget.tsx`). They
 * stay the model because every rule below is stated in them.
 *
 * - **Actual**: money gone. A grant instalment PAID inside the year (cancelled grants
 *   included — the money left), or a core cost scheduled on or before today.
 * - **Projected**: money planned but not yet committed. Round budget not yet awarded, and
 *   the contingency.
 * - **Still to pay**: money owed by the year end. Grants awarded and not yet paid, and core
 *   costs scheduled after today (fixed costs, moved here from Projected on 2026-09-29).
 *   A core cost is still a PLAN, not a ledger: Custodian never sees the rent go out.
 *
 * An earlier cut had "Awarded" (paid + unpaid together) beside a "Deducted from balance"
 * column, and nobody could see why a programme with £26,000 awarded deducted nothing: it
 * had been paid. Splitting the paid half out as Actual makes every deduction visible.
 *
 * ## Available balance
 *
 * `available = balance − projected − still to pay − since balance + income to come`.
 *
 * "Income to come" is every income entry dated AFTER the reading: what the plan says has
 * arrived since then (Actual, not yet in the balance) plus what is still Projected.
 * Income dated on or before the reading is already in the balance and is not added
 * again.
 *
 * ## Two Available figures (agreed with Alex 2026-09-30)
 *
 * `available` adds **Fixed** income only (a signed pledge, a set dividend);
 * `availableWithProjected` adds **Projected** income on top. Income that may never land
 * must not raise the figure a foundation commits grants against, and the second figure
 * sits beside it so the projected money is still in view. With no income lines they are
 * the same number.
 *
 * The last term is money that is Actual but NOT inside the balance, because it went after
 * the day the balance was read: grant payments made after the reading, and core costs
 * scheduled between the reading and today. A June reading followed by an August payment
 * does not contain that payment. It is zero whenever the balance is as at today.
 *
 * Without projection and contingency this is exactly the cash flow's headroom
 * (`buildCashFlow`), because both are built from the same instalment rows. A test pins it.
 *
 * ## What is deliberately not counted
 *
 * Instalments due after the year end (years two and three of a multi-year grant are paid
 * from later years' balances), and undated ("TBC") instalments, which have no year to
 * fall in. No path writes an undated instalment any more; the rows that remain predate
 * the rule and are left out silently.
 *
 * ## Projected round budget is held until a round is decided
 *
 * A round-programme's budget is held while its round is upcoming, open, or closed with
 * applications still undecided, because the foundation may award up to the ceiling. What
 * is held is the budget less what has already been awarded against it
 * (`roundProgrammeSpend`, the same figure the shortlist meter and the budget ceiling
 * read). Once a round has closed and every application is decided, any unspent remainder
 * is released: nobody can award it any more.
 */

export type SummaryFigures = {
  actual: number
  projected: number
  stillToPay: number
}

export type SummaryChild = SummaryFigures & {
  key: string
  name: string
  colour: string | null
  /**
   * How far this programme's year has gone past its annual budget line, or 0. Counts
   * prior-year instalments too, because the programme budget total covers them.
   */
  over: number
  /** Income lines only: Fixed, or Projected when FALSE. */
  fixed?: boolean
}

export type SummaryLineKind = 'core' | 'prior' | 'current' | 'contingency' | 'income'

export type SummaryLine = SummaryFigures & {
  kind: SummaryLineKind
  children: SummaryChild[]
}

export type BalanceSummary = {
  lines: SummaryLine[]
  /** Money OUT: every line but income. */
  total: SummaryFigures
  /**
   * Money IN: the income line's figures, plus `sinceBalance` — income dated after the
   * reading and so not inside it. `toCome` is what Available adds. NULL with no income.
   */
  income: {
    actual: number
    projected: number
    /** The year's income from Fixed lines, whatever its date: the certainty split, not the time one. */
    fixedTotal: number
    /** The year's income from lines not marked Fixed. */
    projectedTotal: number
    /** Fixed income dated after the reading. NULL without a reading. */
    fixedToCome: number | null
    /** Projected (not Fixed) income dated after the reading. NULL without a reading. */
    projectedToCome: number | null
  } | null
  /**
   * Actual money that went AFTER the balance was read, so is not inside it: grant payments
   * and scheduled core costs. NULL without a reading.
   */
  sinceBalance: { grants: number; core: number; total: number } | null
  /** Everything still to come out of the balance. NULL without a reading. */
  deducted: number | null
  /** Balance less `deducted`, before income. NULL without a reading. */
  beforeIncome: number | null
  /** Balance less everything to come out, plus FIXED income to come. NULL without a reading. */
  available: number | null
  /** `available` plus PROJECTED income to come. NULL without a reading. */
  availableWithProjected: number | null
  /** The sum of the programme lines: what contingency is a percentage of. */
  grantBudget: number
  contingency: { percent: number; amount: number } | null
}

/** One grouped instalment row. See `budgetPanelQueries`. */
export type GrantInstalment = {
  programmeId: string
  programmeName: string
  programmeColour: string | null
  /** The grant's round belongs to an earlier financial year. */
  prior: boolean
  /** `paid_date` for a paid instalment, `due_date` for an unpaid one. */
  day: string
  paid: boolean
  amount: number
}

/** A round-programme of THIS year, with what has been awarded against it. */
export type RoundProgrammeBudget = {
  programmeId: string
  programmeName: string
  programmeColour: string | null
  budget: number
  /** `RoundProgrammeSpend.awardedThisYear`. */
  awardedThisYear: number
  /** Still open to awards: upcoming, open, or closed with applications undecided. */
  held: boolean
}

export type BalanceSummaryInput = {
  fy: { start: string; end: string }
  today: string
  balance: { amount: number; asAtDate: string } | null
  costLines: CostLineInput[]
  /** Income lines from the budget. Optional: a budget with none reads exactly as before. */
  incomeLines?: CostLineInput[]
  /**
   * Paid rows (cancelled grants included: the money left) and unpaid rows (cancelled
   * excluded, dated, due by the year end), exactly as the cash flow reads them.
   */
  instalments: GrantInstalment[]
  roundProgrammes: RoundProgrammeBudget[]
  /** Annual budget line per programme. */
  programmeBudgets: Map<string, number>
  contingencyPercent: number | null
}

type Programme = { name: string; colour: string | null }

const zero = (): SummaryFigures => ({ actual: 0, projected: 0, stillToPay: 0 })

function add(into: SummaryFigures, from: SummaryFigures) {
  into.actual += from.actual
  into.projected += from.projected
  into.stillToPay += from.stillToPay
}

function rounded<T extends SummaryFigures>(f: T): T {
  return {
    ...f,
    actual: round2(f.actual),
    projected: round2(f.projected),
    stillToPay: round2(f.stillToPay),
  }
}

const hasAny = (f: SummaryFigures) => f.actual !== 0 || f.projected !== 0 || f.stillToPay !== 0

/** A line from its children, which are rounded, dropped when empty, and sorted by name. */
function line(kind: SummaryLineKind, children: SummaryChild[]): SummaryLine | null {
  const kept = children
    .map(rounded)
    .filter(hasAny)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (kept.length === 0) return null
  const sum = zero()
  for (const c of kept) add(sum, c)
  return { kind, children: kept, ...rounded(sum) }
}

export function buildBalanceSummary(input: BalanceSummaryInput): BalanceSummary {
  const { fy, today, balance } = input
  /** After the reading, so not inside the balance. Nothing counts without a reading. */
  const afterReading = (day: string) => balance !== null && day > balance.asAtDate
  let grantsSince = 0
  let coreSince = 0

  // ── Core costs, per line as stored ─────────────────────────────────────────
  const core: SummaryChild[] = input.costLines.map((l, i) => {
    const f = zero()
    for (const e of costEntries(l, fy)) {
      if (e.date <= today) {
        f.actual += e.amount
        if (afterReading(e.date)) coreSince += e.amount
      } else {
        // A scheduled core cost is a fixed cost the foundation has planned to pay, not an
        // estimate, so it is owed rather than projected (agreed 2026-09-29).
        f.stillToPay += e.amount
      }
    }
    return {
      key: `core-${i}`,
      name: l.label?.trim() || CORE_COSTS_LABEL,
      colour: null,
      over: 0,
      ...f,
    }
  })

  // ── Grants, per programme, split by the round's year ───────────────────────
  const programmes = new Map<string, Programme>()
  const byProgramme = {
    prior: new Map<string, SummaryFigures>(),
    current: new Map<string, SummaryFigures>(),
  }
  const figuresFor = (cohort: 'prior' | 'current', id: string, p: Programme) => {
    if (!programmes.has(id)) programmes.set(id, p)
    const map = byProgramme[cohort]
    const existing = map.get(id)
    if (existing) return existing
    const fresh = zero()
    map.set(id, fresh)
    return fresh
  }

  for (const i of input.instalments) {
    const f = figuresFor(i.prior ? 'prior' : 'current', i.programmeId, {
      name: i.programmeName,
      colour: i.programmeColour,
    })
    if (i.paid) {
      // Paid rows reach back before the year for the reading's sake only.
      if (i.day >= fy.start && i.day <= fy.end) f.actual += i.amount
      if (afterReading(i.day)) grantsSince += i.amount
    } else {
      f.stillToPay += i.amount
    }
  }

  for (const rp of input.roundProgrammes) {
    const f = figuresFor('current', rp.programmeId, {
      name: rp.programmeName,
      colour: rp.programmeColour,
    })
    if (rp.held) f.projected += Math.max(0, rp.budget - rp.awardedThisYear)
  }

  const children = (cohort: 'prior' | 'current'): SummaryChild[] =>
    [...byProgramme[cohort]].map(([id, f]) => {
      const p = programmes.get(id)!
      let over = 0
      const budget = input.programmeBudgets.get(id)
      if (cohort === 'current' && budget !== undefined) {
        const prior = byProgramme.prior.get(id)
        const spend =
          f.actual + f.projected + f.stillToPay + (prior ? prior.actual + prior.stillToPay : 0)
        over = spend - budget > 0.005 ? round2(spend - budget) : 0
      }
      return { key: id, name: p.name, colour: p.colour, over, ...f }
    })

  // ── Contingency ─────────────────────────────────────────────────────────────
  const grantBudget = round2([...input.programmeBudgets.values()].reduce((s, n) => s + n, 0))
  const percent = input.contingencyPercent ?? 0
  const contingency =
    percent > 0 && grantBudget > 0
      ? { percent, amount: round2((grantBudget * percent) / 100) }
      : null

  // ── Income, per line as stored ─────────────────────────────────────────────
  // Arrived by today is Actual, still to come Projected: the same split core costs make,
  // except that income is never "owed". What lands after the reading is added back.
  const incomeAfterReading = { fixed: 0, projected: 0 }
  const income: SummaryChild[] = (input.incomeLines ?? []).map((l, i) => {
    const f = zero()
    const fixed = l.fixed === true
    for (const e of costEntries(l, fy)) {
      if (e.date <= today) f.actual += e.amount
      else f.projected += e.amount
      if (afterReading(e.date)) incomeAfterReading[fixed ? 'fixed' : 'projected'] += e.amount
    }
    return {
      key: `income-${i}`,
      name: l.label?.trim() || INCOME_LABEL,
      colour: null,
      over: 0,
      fixed,
      ...f,
    }
  })

  const lines = [
    line('core', core),
    line('prior', children('prior')),
    line('current', children('current')),
  ].filter((l): l is SummaryLine => l !== null)

  if (contingency) {
    lines.push({
      kind: 'contingency',
      children: [],
      actual: 0,
      projected: contingency.amount,
      stillToPay: 0,
    })
  }

  // Summed BEFORE the income line joins, so `total` stays money out.
  const sum = zero()
  for (const l of lines) add(sum, l)
  const total = rounded(sum)

  const incomeLine = line('income', income)
  if (incomeLine) lines.push(incomeLine)

  const sinceBalance = balance
    ? {
        grants: round2(grantsSince),
        core: round2(coreSince),
        total: round2(grantsSince + coreSince),
      }
    : null
  const deducted = sinceBalance
    ? round2(total.projected + total.stillToPay + sinceBalance.total)
    : null
  const beforeIncome = balance && deducted !== null ? round2(balance.amount - deducted) : null
  const fixedToCome = balance ? round2(incomeAfterReading.fixed) : null
  const projectedToCome = balance ? round2(incomeAfterReading.projected) : null
  const available = beforeIncome !== null ? round2(beforeIncome + (fixedToCome ?? 0)) : null

  return {
    lines,
    total,
    income: incomeLine
      ? {
          actual: incomeLine.actual,
          projected: incomeLine.projected,
          fixedTotal: round2(
            incomeLine.children
              .filter((c) => c.fixed)
              .reduce((n, c) => n + c.actual + c.projected, 0),
          ),
          projectedTotal: round2(
            incomeLine.children
              .filter((c) => !c.fixed)
              .reduce((n, c) => n + c.actual + c.projected, 0),
          ),
          fixedToCome,
          projectedToCome,
        }
      : null,
    sinceBalance,
    deducted,
    beforeIncome,
    available,
    availableWithProjected: available !== null ? round2(available + (projectedToCome ?? 0)) : null,
    grantBudget,
    contingency,
  }
}
