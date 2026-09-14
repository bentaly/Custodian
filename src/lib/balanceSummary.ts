import { CORE_COSTS_LABEL } from './annualBudget'
import { costEntries, round2, type CostLineInput } from './coreCosts'

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
 *
 * Grant lines break down by programme and core costs by their own labels. A parent is the
 * sum of its children and nothing else, so a breakdown cannot drift from its headline.
 *
 * ## The three columns (agreed 2026-09-13)
 *
 * - **Actual**: money gone. A grant instalment PAID inside the year (cancelled grants
 *   included — the money left), or a core cost scheduled on or before today.
 * - **Projected**: money planned but not yet committed. Core costs still to come, round
 *   budget not yet awarded, and the contingency.
 * - **Still to pay**: grants awarded and not yet paid, due by the year end.
 *
 * An earlier cut had "Awarded" (paid + unpaid together) beside a "Deducted from balance"
 * column, and nobody could see why a programme with £26,000 awarded deducted nothing: it
 * had been paid. Splitting the paid half out as Actual makes every deduction visible.
 *
 * ## Available balance
 *
 * `available = balance − projected − still to pay − since balance`.
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
}

export type SummaryLineKind = 'core' | 'prior' | 'current' | 'contingency'

export type SummaryLine = SummaryFigures & {
  kind: SummaryLineKind
  children: SummaryChild[]
}

export type BalanceSummary = {
  lines: SummaryLine[]
  total: SummaryFigures
  /**
   * Actual money that went AFTER the balance was read, so is not inside it: grant payments
   * and scheduled core costs. NULL without a reading.
   */
  sinceBalance: { grants: number; core: number; total: number } | null
  /** Everything still to come out of the balance. NULL without a reading. */
  deducted: number | null
  /** NULL without a balance reading. */
  available: number | null
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
        f.projected += e.amount
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

  const sum = zero()
  for (const l of lines) add(sum, l)
  const total = rounded(sum)

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

  return {
    lines,
    total,
    sinceBalance,
    deducted,
    available: balance && deducted !== null ? round2(balance.amount - deducted) : null,
    grantBudget,
    contingency,
  }
}
