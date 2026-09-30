import { costEntries, monthsOfYear, round2, type CostLineInput } from './coreCosts'

/**
 * The year month by month: what leaves the account, and where the balance ends up.
 *
 * The Finance → Balance & budget screen's answer to "can we cover what we promised",
 * at the grain a finance lead actually plans at. Two kinds of outflow:
 *
 * - **Grant payments** — award instalments. A PAID one falls on its paid date and
 *   includes cancelled grants (the money left; CLAUDE.md's money rule). An UNPAID one
 *   falls on its due date, excludes cancelled grants, and if it is overdue falls TODAY
 *   instead: it has not left, so it is still to come, and drawing it in a past month
 *   would show an outflow that never happened.
 * - **Core costs** — the non-grant budget lines, placed by `costEntries`.
 *
 * And one inflow: **income** — the budget's income lines, placed by the same
 * `costEntries` and ADDED to the balance. Only what lands after the reading is added:
 * income dated on or before it is already in the balance, and counting it again is the
 * one way this table could overstate the account.
 *
 * Undated ("TBC") instalments are not in it, for the same reason they are not in
 * `dueByYearEnd`: there is no month to put them in.
 *
 * ## The balance is projected from the day it was TRUE
 *
 * A reading is as at a date, and only what leaves AFTER that date is still to come out of
 * it. So the projection subtracts grant payments made since the reading, every unpaid
 * instalment falling due by the year end, and core costs scheduled after the reading.
 * The old headroom was `balance − dueByYearEnd` and missed the first term: a balance
 * recorded in June, followed by £10,000 paid in August, still read £10,000 better than
 * the account.
 *
 * `headroom` is the year-end month's closing figure BY CONSTRUCTION — one sum, not two
 * that happen to agree — so the card above and the table beneath cannot disagree.
 */

export type InstalmentDay = {
  /** `paid_date` for a paid instalment, `due_date` for an unpaid one. */
  day: string
  paid: boolean
  amount: number
}

export type CashFlowMonth = {
  /** `yyyy-mm` */
  key: string
  start: string
  end: string
  grants: number
  /** The part of `grants` that is overdue and has been drawn into this (the current) month. */
  overdue: number
  core: number
  /** Money out: grants plus core costs. */
  total: number
  /** Money in: the budget's income lines placed in this month. */
  income: number
  /** The whole month is behind today. */
  past: boolean
  current: boolean
  /** Projected balance at the month end. NULL with no reading, or before the reading's month. */
  closing: number | null
}

export type CashFlow = {
  months: CashFlowMonth[]
  /**
   * What stands between the reading and the year end, as four parts. NULL with no
   * reading. `balance − paidGrants − dueGrants − core + income = headroom`.
   */
  sinceBalance: { paidGrants: number; dueGrants: number; core: number; income: number } | null
  headroom: number | null
}

type Entry = {
  date: string
  /** Positive for money out AND in; `kind` says which way it moves the balance. */
  amount: number
  kind: 'grant' | 'core' | 'income'
  paid: boolean
  overdue: boolean
}

export function buildCashFlow(input: {
  fy: { start: string; end: string }
  today: string
  balance: { amount: number; asAtDate: string } | null
  instalments: InstalmentDay[]
  costLines: CostLineInput[]
  incomeLines?: CostLineInput[]
}): CashFlow {
  const { fy, today, balance } = input

  const entries: Entry[] = [
    ...input.instalments.map((i) => {
      const overdue = !i.paid && i.day < today
      return {
        date: overdue ? today : i.day,
        amount: i.amount,
        kind: 'grant' as const,
        paid: i.paid,
        overdue,
      }
    }),
    ...input.costLines.flatMap((line) =>
      costEntries(line, fy).map((e) => ({
        ...e,
        kind: 'core' as const,
        paid: false,
        overdue: false,
      })),
    ),
    ...(input.incomeLines ?? []).flatMap((line) =>
      costEntries(line, fy).map((e) => ({
        ...e,
        kind: 'income' as const,
        paid: false,
        overdue: false,
      })),
    ),
  ].filter((o) => Number.isFinite(o.amount) && o.amount !== 0)

  /**
   * Still to come out of the balance. An unpaid instalment always is — it cannot be in a
   * balance whatever the reading's date. Anything else is, if it falls after the reading.
   */
  const afterReading = (o: Entry) =>
    balance !== null && ((o.kind === 'grant' && !o.paid) || o.date > balance.asAtDate)

  const sum = (os: Entry[]) => round2(os.reduce((s, o) => s + o.amount, 0))
  /** What a set of entries does to the balance: money out down, income up. */
  const net = (os: Entry[]) =>
    round2(os.reduce((s, o) => s + (o.kind === 'income' ? -o.amount : o.amount), 0))

  const months = monthsOfYear(fy).map((m): CashFlowMonth => {
    const inMonth = entries.filter((o) => o.date >= m.start && o.date <= m.end)
    const grants = sum(inMonth.filter((o) => o.kind === 'grant'))
    const core = sum(inMonth.filter((o) => o.kind === 'core'))
    const income = sum(inMonth.filter((o) => o.kind === 'income'))
    return {
      ...m,
      grants,
      overdue: sum(inMonth.filter((o) => o.overdue)),
      core,
      total: round2(grants + core),
      income,
      past: m.end < today,
      current: m.start <= today && today <= m.end,
      closing:
        balance && m.end >= balance.asAtDate
          ? round2(balance.amount - net(entries.filter((o) => afterReading(o) && o.date <= m.end)))
          : null,
    }
  })

  if (!balance) return { months, sinceBalance: null, headroom: null }

  const toCome = entries.filter((o) => afterReading(o) && o.date <= fy.end)
  const sinceBalance = {
    paidGrants: sum(toCome.filter((o) => o.kind === 'grant' && o.paid)),
    dueGrants: sum(toCome.filter((o) => o.kind === 'grant' && !o.paid)),
    core: sum(toCome.filter((o) => o.kind === 'core')),
    income: sum(toCome.filter((o) => o.kind === 'income')),
  }
  return {
    months,
    sinceBalance,
    headroom: round2(balance.amount - net(toCome)),
  }
}
