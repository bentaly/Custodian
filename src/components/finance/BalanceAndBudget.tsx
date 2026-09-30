import {
  CoinsPoundIcon,
  CreditCardIcon,
  ArrowDownLeft02Icon,
  ArrowUpRight02Icon,
} from '@hugeicons/core-free-icons'
import type { BalanceAndBudget as Data } from '../../server/finance/budget'
import type { SummaryLine, SummaryLineKind } from '../../lib/balanceSummary'
import { MONTH_NAMES } from '../../lib/financialYear'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { fmtDate, fmtExact } from '../../lib/format'
import { C } from '../ui/tokens'
import {
  BreakdownTable,
  Card,
  EmptyState,
  KPI_TINTS,
  MiniKpi,
  Tabs,
  TextLink,
  Tooltip,
  type BreakdownColumn,
  type BreakdownRow,
} from '../ui'

/**
 * The Balance & budget screen — Finance's second route.
 *
 * Answers one question: **after everything this year still has to pay, what is left?**
 *
 * ## Shape (Notion: "Finance balance screen — line items", agreed 2026-09-13)
 *
 * The same pieces as Payments: headline cards on top (`HeadlineCards`: Balance, Income
 * total, Expenditure total, Available balance, always all four since 2026-09-30, tinted by
 * place in the row as `KPI_TINTS` says), then one card holding a tab pair and the table
 * under it. Summary is the reconciliation,
 * Cash flow the month table. The six stat cards and per-programme meters this replaced read
 * as a different screen bolted on, and cards cannot carry a line with more than one figure.
 *
 * ## The summary's columns
 *
 * FOUR since 2026-09-30 (Alex), the year split two ways: **Fixed | Projected** by
 * certainty, **To date | To come** by time (`fourWay`). Each pair sums to the line's year,
 * the figure Settings shows. They replaced Actual / Projected / Still to pay, where
 * "Actual" read as "certain" beside cards that say Fixed, and a line's year total was
 * split across two columns with no sum (Staff read £30,000 here and £60,000 in Settings).
 * The footer works from the balance down to Available balance so it can be checked by
 * subtraction. A figure a line cannot have (a contingency is never paid) reads "n/a",
 * which is not the same statement as £0. The rules are `src/lib/balanceSummary.ts`.
 *
 * ## Each half stands alone
 *
 * No balance leaves the Balance and Available cards reading "--" and drops the footer's
 * arithmetic, since it means nothing without one; the three columns still stand. No budget drops core costs and contingency; grants
 * and round budgets still show.
 *
 * ## Income (Notion: "Finance balance screen: adding income streams", 2026-09-30)
 *
 * The budget's income lines are the one line that is money IN. They read Actual and
 * Projected, never Still to pay, sit below the Total (which stays money out), and the
 * footer adds them back on the way to Available. Each income line is **Fixed** or
 * **Projected**: **Available balance** counts Fixed income only, and the figure with
 * Projected income added is stated beside it (a line on the card, the last rows of the
 * footer) but never folded in. Income that may never land never raises Available.
 */

export type BalanceView = 'summary' | 'cashflow'

export function BalanceAndBudget({
  data,
  view,
  onViewChange,
}: {
  data: Data
  view: BalanceView
  onViewChange: (view: BalanceView) => void
}) {
  const { balance, financialYear: fy } = data

  return (
    <div className="flex flex-col gap-4">
      <HeadlineCards data={data} />

      {data.empty ? (
        <EmptyState>
          <p className="font-display text-body" style={{ color: C.sub }}>
            Nothing recorded yet. Use <span className="font-medium">Update balance</span> to enter
            what is in the bank, or <TextLink to="/settings/budget">set an annual budget</TextLink>{' '}
            to plan the year&rsquo;s giving, costs and income. Either works on its own.
          </p>
        </EmptyState>
      ) : (
        <>
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs<BalanceView>
                ariaLabel="Balance and budget view"
                value={view}
                onChange={onViewChange}
                items={[
                  { id: 'summary', label: 'Summary' },
                  { id: 'cashflow', label: 'Cash flow' },
                ]}
              />
              <span className="font-display text-label" style={{ color: C.faint }}>
                Financial year {fy.label}, to {fmtDate(fy.end)}
              </span>
            </div>
            {view === 'summary' ? <Summary data={data} /> : <CashFlowTable data={data} />}
          </Card>

          {balance && <BalanceNote balance={balance} />}
        </>
      )}
    </div>
  )
}

/**
 * The four headline cards, always all four and in this order (agreed with Ben
 * 2026-09-30): Balance, Available balance, Income total, Expenditure total. The two
 * figures a foundation acts on come first, side by side; the totals that explain them
 * follow.
 *
 * The two totals are the WHOLE year, split by certainty rather than by date:
 * **Fixed** is money that will move for certain (a Fixed income line; spend already paid,
 * awarded or scheduled, i.e. the Summary's Actual and Still to pay) and **Projected** is
 * money that may not (income not marked Fixed; round budget not yet awarded, and the
 * contingency). The Summary table's Actual column is about TIME, which is why the cards
 * say Fixed rather than Actual.
 *
 * Available is projected to the year end from the balance's as-at date, counting Fixed
 * income only. Its line reads "£X Fixed | £Y Projected" like the totals', but there the
 * two are ALTERNATIVES (Fixed income only; Projected income too), not parts that sum to
 * the headline. Projected income is never folded into the headline itself. It is also not
 * Balance + Income − Expenditure to the penny: the totals include money that moved before
 * the reading and is already inside the balance. The Summary footer shows that arithmetic
 * line by line.
 *
 * Each card carries the date it is true at: the reading's day, the financial year, the
 * year end. Missing figures read "--" with what would fill them, rather than £0, which
 * would be a statement about the foundation's money.
 */
function HeadlineCards({ data }: { data: Data }) {
  const { balance, summary, financialYear: fy } = data
  const income = summary.income
  const out = summary.total
  const hasSpend = summary.lines.some((l) => l.kind !== 'income')
  const split = (fixed: number, projected: number) =>
    `${fmtExact(fixed)} Fixed | ${fmtExact(projected)} Projected`

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MiniKpi
        tint={KPI_TINTS.violet}
        icon={CreditCardIcon}
        label="Balance"
        value={balance ? fmtExact(balance.amount) : '--'}
        // The as-at date is part of the number, not metadata about it: a balance without
        // the day it was true is not something anybody can act on.
        sub={
          !balance
            ? 'No balance recorded yet'
            : balance.stale
              ? `As at ${fmtDate(balance.asAtDate)} · ${balance.daysOld} days old`
              : `As at ${fmtDate(balance.asAtDate)}`
        }
        subColour={balance?.stale ? C.warning : undefined}
      />
      <MiniKpi
        tint={KPI_TINTS.green}
        icon={CoinsPoundIcon}
        // The date in the label, like the two totals, so the line under the figure has room.
        label={`Available balance at ${fmtDate(fy.end)}`}
        value={summary.available !== null ? fmtExact(summary.available) : '--'}
        valueColour={summary.available !== null && summary.available < 0 ? C.danger : undefined}
        // The same "Fixed | Projected" line as the totals, but the two are ALTERNATIVES,
        // not parts: counting Fixed income only (the figure above), and counting Projected
        // income as well. They do not add up to the headline, as the totals' parts do.
        sub={
          summary.available === null
            ? 'Record a balance to see this'
            : income && summary.availableWithProjected !== null
              ? split(summary.available, summary.availableWithProjected)
              : 'After everything still to pay'
        }
      />
      <MiniKpi
        tint={KPI_TINTS.amber}
        // In and out by direction: two money glyphs read as one at card size.
        icon={ArrowDownLeft02Icon}
        label={`Income total ${fy.label}`}
        value={income ? fmtExact(income.fixedTotal + income.projectedTotal) : '--'}
        sub={income ? split(income.fixedTotal, income.projectedTotal) : 'None in the budget'}
      />
      <MiniKpi
        tint={KPI_TINTS.pink}
        icon={ArrowUpRight02Icon}
        label={`Expenditure total ${fy.label}`}
        value={hasSpend ? fmtExact(out.actual + out.stillToPay + out.projected) : '--'}
        sub={
          hasSpend
            ? split(out.actual + out.stillToPay, out.projected)
            : 'Nothing budgeted or awarded'
        }
      />
    </div>
  )
}

type Item = {
  name: string
  hint?: string
  colour?: string
  /** Over its programme budget line by this much. */
  over?: number
  /** NULL where the line cannot have such a figure — shown "n/a", never £0. */
  fixed: number | null
  projected: number | null
  toDate: number | null
  toPay: number | null
}

function lineName(kind: SummaryLineKind, fyLabel: string): string {
  switch (kind) {
    case 'core':
      return 'Core costs'
    case 'prior':
      return 'Prior-year committed grants'
    case 'current':
      return `${fyLabel} grant spend`
    case 'contingency':
      return 'Contingency'
    case 'income':
      return 'Income'
  }
}

function lineHint(line: SummaryLine, data: Data): string {
  switch (line.kind) {
    case 'core':
      return 'Scheduled to date, and still to come this year'
    case 'prior':
      return 'This year’s instalments on grants from earlier years’ rounds'
    case 'current':
      return 'Grants from this year’s rounds'
    case 'contingency':
      return data.summary.contingency
        ? `${data.summary.contingency.percent}% of the ${fmtExact(data.summary.grantBudget)} grant budget`
        : ''
    case 'income':
      return 'Money in: To date has arrived, To come is still to come in. Not in the total below'
  }
}

/**
 * Which of the four columns a line can have at all. A cost has no Projected half (every
 * core cost is Fixed until cost lines get the Fixed flag), a contingency is never Fixed
 * nor paid.
 */
const HAS = {
  core: { fixed: true, projected: false, toDate: true, toPay: true },
  prior: { fixed: true, projected: false, toDate: true, toPay: true },
  current: { fixed: true, projected: true, toDate: true, toPay: true },
  contingency: { fixed: false, projected: true, toDate: false, toPay: true },
  income: { fixed: true, projected: true, toDate: true, toPay: true },
} as const

/** A kind this build does not know (an old tab, a newer server): show every figure. */
const SHOW_ALL = { fixed: true, projected: true, toDate: true, toPay: true }

/**
 * A line's four figures: the year split two ways (Alex, 2026-09-30).
 *
 * **Fixed | Projected** by certainty, the same split as the cards: for spend, Fixed is
 * what is paid, awarded or scheduled (`actual + stillToPay`) and Projected is round budget
 * not yet awarded and the contingency; for income it is the line's Fixed flag.
 * **To date | To come** by time: what has moved this year so far, and what has not.
 * "To come" rather than Alex's "To pay" because it has to be true of the Income row too,
 * where the money is still to come IN (Ben, 2026-09-30). Each
 * pair sums to the line's year, which is the figure Settings shows for it.
 */
function fourWay(
  kind: SummaryLineKind,
  f: { actual: number; projected: number; stillToPay: number },
  /** Income's certainty split. NULL on a side means the line cannot have it: n/a. */
  incomeFixed?: { fixed: number | null; projected: number | null },
) {
  const has = (HAS as Record<string, typeof SHOW_ALL>)[kind] ?? SHOW_ALL
  // Income's time split lives in actual/projected; its certainty split is the flag.
  const certain = incomeFixed ?? { fixed: f.actual + f.stillToPay, projected: f.projected }
  const toPay = kind === 'income' ? f.projected : f.stillToPay + f.projected
  return {
    fixed: has.fixed ? certain.fixed : null,
    projected: has.projected ? certain.projected : null,
    toDate: has.toDate ? f.actual : null,
    toPay: has.toPay ? toPay : null,
  }
}

function Summary({ data }: { data: Data }) {
  const { balance, summary, financialYear: fy } = data

  if (summary.lines.length === 0) {
    return (
      <p className="py-6 text-center font-display text-body" style={{ color: C.faint }}>
        Nothing awarded, budgeted or held in a round for {fy.label} yet.
      </p>
    )
  }

  const rows: BreakdownRow<Item>[] = summary.lines.map((line) => ({
    key: line.kind,
    data: {
      name: lineName(line.kind, fy.label),
      hint: lineHint(line, data),
      ...fourWay(
        line.kind,
        line,
        line.kind === 'income' && summary.income
          ? { fixed: summary.income.fixedTotal, projected: summary.income.projectedTotal }
          : undefined,
      ),
    },
    children: line.children.map((child, i) => ({
      key: child.key,
      data: {
        name: child.name,
        hint: line.kind === 'income' ? (child.fixed ? 'Fixed' : 'Projected') : undefined,
        // Core-cost and income lines are not programmes and have no colour of their own.
        colour:
          line.kind === 'core' || line.kind === 'income'
            ? undefined
            : resolveProgrammeColour(child.colour, i),
        over: child.over,
        ...fourWay(
          line.kind,
          child,
          line.kind === 'income'
            ? // One line is Fixed or Projected, never both: the other side does not
              // apply, which is n/a rather than £0.
              child.fixed
              ? { fixed: child.actual + child.projected, projected: null }
              : { fixed: null, projected: child.actual + child.projected }
            : undefined,
        ),
      },
    })),
  }))

  const money = (n: number | null, colour?: string) =>
    n === null ? (
      <span style={{ color: C.faint }}>n/a</span>
    ) : (
      <span style={{ color: colour }}>{fmtExact(n)}</span>
    )

  // Each header carries an ⓘ: four columns that split one year two ways is not something
  // a reader can be expected to guess, and the pair each column belongs to is the key.
  const column = (
    id: keyof typeof SHOW_ALL,
    header: string,
    help: string,
  ): BreakdownColumn<Item> => ({
    id,
    header: (
      <span className="inline-flex items-center gap-1">
        {header}
        <Tooltip label={`About ${header}`}>{help}</Tooltip>
      </span>
    ),
    cell: (r) => money(r[id], r.over ? C.danger : undefined),
  })
  const columns = [
    column(
      'fixed',
      'Fixed',
      'Money that will move for certain this year: grants paid or awarded, core costs, and income marked Fixed.',
    ),
    column(
      'projected',
      'Projected',
      'Money that is expected to move: round budget not yet awarded, the contingency, and income not marked Fixed.',
    ),
    column(
      'toDate',
      'To date',
      'What has already moved this financial year: instalments paid, and core costs and income whose dates have passed.',
    ),
    column(
      'toPay',
      'To come',
      `What has not moved yet, between now and ${fmtDate(fy.end)}, including projected: spending still to go out, and income still to come in.`,
    ),
  ]
  const out = summary.total

  // Same spacing as the figure columns above (`BreakdownTable`): extra room after every
  // column but the last, which is where the balance arithmetic sits.
  const footCell = 'py-3 pl-3 pr-10 text-left tabular-nums whitespace-nowrap'
  const footLast = 'px-3 py-3 text-left tabular-nums whitespace-nowrap'
  const footLabel = 'py-3 pl-8 pr-3 text-left'
  const since = summary.sinceBalance
  const income = summary.income
  const footer = (
    <>
      <tr className="border-t font-medium" style={{ borderColor: C.line, color: C.ink }}>
        <th scope="row" className={`${footLabel} font-medium`}>
          {/* Income is a line in the table but never in this sum, so say which total it is. */}
          {summary.income ? 'Total money out' : 'Total'}
        </th>
        <td className={footCell}>{fmtExact(out.actual + out.stillToPay)}</td>
        <td className={footCell}>{fmtExact(out.projected)}</td>
        <td className={footCell}>{fmtExact(out.actual)}</td>
        <td className={footLast}>{fmtExact(out.stillToPay + out.projected)}</td>
      </tr>
      {/* From the balance down to what is available, one term per row, so the card above
          can be checked by subtraction. */}
      {balance && since && summary.available !== null && (
        <>
          <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
            <th scope="row" colSpan={4} className={`${footLabel} font-normal`}>
              Balance as at {fmtDate(balance.asAtDate)}
            </th>
            <td className={footLast}>{fmtExact(balance.amount)}</td>
          </tr>
          <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
            <th scope="row" colSpan={4} className={`${footLabel} font-normal`}>
              Less spending to come
            </th>
            <td className={footLast}>{fmtExact(out.projected + out.stillToPay)}</td>
          </tr>
          {since.total > 0 && (
            <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
              <th scope="row" colSpan={4} className={`${footLabel} font-normal`}>
                Less spend to date since {fmtDate(balance.asAtDate)}, not yet in that balance
              </th>
              <td className={footLast}>{fmtExact(since.total)}</td>
            </tr>
          )}
          {income && (income.fixedToCome ?? 0) > 0 && (
            <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
              <th scope="row" colSpan={4} className={`${footLabel} font-normal`}>
                Plus fixed income after {fmtDate(balance.asAtDate)}
              </th>
              <td className={footLast}>{fmtExact(income.fixedToCome ?? 0)}</td>
            </tr>
          )}
          <tr className="border-t font-medium" style={{ borderColor: C.line, color: C.ink }}>
            <th scope="row" colSpan={4} className={`${footLabel} font-medium`}>
              Available balance
            </th>
            <td
              className={footLast}
              style={{ color: summary.available < 0 ? C.danger : C.success }}
            >
              {fmtExact(summary.available)}
            </td>
          </tr>
          {/* Projected income never reaches the figure above: it may not land. It gets a
              second figure of its own, so it is still in view. */}
          {income &&
            (income.projectedToCome ?? 0) > 0 &&
            summary.availableWithProjected !== null && (
              <>
                <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
                  <th scope="row" colSpan={4} className={`${footLabel} font-normal`}>
                    Plus projected income after {fmtDate(balance.asAtDate)}
                  </th>
                  <td className={footLast}>{fmtExact(income.projectedToCome ?? 0)}</td>
                </tr>
                <tr className="border-t font-medium" style={{ borderColor: C.line, color: C.ink }}>
                  <th scope="row" colSpan={4} className={`${footLabel} font-medium`}>
                    Available including projected income
                  </th>
                  <td
                    className={footLast}
                    style={{
                      color: summary.availableWithProjected < 0 ? C.danger : C.success,
                    }}
                  >
                    {fmtExact(summary.availableWithProjected)}
                  </td>
                </tr>
              </>
            )}
        </>
      )}
    </>
  )

  return (
    <div className="flex flex-col gap-3">
      <BreakdownTable
        label="Line item"
        columns={columns}
        rows={rows}
        footer={footer}
        name={(r, depth) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              {r.colour && (
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: r.colour }}
                />
              )}
              <span className={depth === 0 ? 'font-medium' : ''}>{r.name}</span>
            </span>
            {r.hint && (
              <span className="text-label" style={{ color: C.faint }}>
                {r.hint}
              </span>
            )}
            {/* The one warning the old per-programme meters gave that this table would
                otherwise drop: the table carries no budget column to compare against. */}
            {r.over ? (
              <span className="text-label" style={{ color: C.danger }}>
                {fmtExact(r.over)} over budget
              </span>
            ) : null}
          </div>
        )}
      />
      <SummaryNotes data={data} />
    </div>
  )
}

function SummaryNotes({ data }: { data: Data }) {
  const { balance, summary, financialYear: fy } = data
  return (
    <div className="flex flex-col gap-1 font-display text-label" style={{ color: C.faint }}>
      {!data.hasCoreCosts && !summary.contingency && (
        <p>
          No core costs or contingency for {fy.label}.{' '}
          <TextLink to="/settings/budget">Set them in Settings</TextLink>.
        </p>
      )}
      {!balance && <p>Record a balance to see what is available after all of this.</p>}
    </div>
  )
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTH_NAMES[m! - 1]!.slice(0, 3)} ${y}`
}

/**
 * The year month by month: grant payments, core costs, and the balance they leave.
 *
 * A table rather than a chart because a finance lead reads it against their own
 * spreadsheet, figure by figure. Its last closing balance is the summary's available
 * balance before projected round budgets and contingency, because both are built from the
 * same instalment rows (`buildCashFlow`, `buildBalanceSummary`).
 */
function CashFlowTable({ data }: { data: Data }) {
  const { cashFlow, balance, hasCoreCosts, hasIncome, financialYear: fy } = data
  const { months } = cashFlow
  const current = months.find((m) => m.current)
  const cell = 'px-2 py-2 text-left'
  return (
    <div className="flex flex-col gap-3">
      {balance && (
        <p className="font-display text-label" style={{ color: C.faint }}>
          From {fmtExact(balance.amount)} as at {fmtDate(balance.asAtDate)}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-display text-body tabular-nums">
          <thead>
            <tr className="h-10" style={{ backgroundColor: C.wash, color: C.ink }}>
              <th scope="col" className="px-2 text-left font-medium">
                Month
              </th>
              <th scope="col" className={`${cell} font-medium`}>
                Grant payments
              </th>
              {hasCoreCosts && (
                <th scope="col" className={`${cell} font-medium`}>
                  Core costs
                </th>
              )}
              {hasCoreCosts && (
                <th scope="col" className={`${cell} hidden font-medium sm:table-cell`}>
                  Total out
                </th>
              )}
              {hasIncome && (
                <th scope="col" className={`${cell} font-medium`}>
                  Income
                </th>
              )}
              {balance && (
                <th scope="col" className={`${cell} font-medium`}>
                  Balance at month end
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr
                key={m.key}
                className="border-t"
                style={{
                  borderColor: C.line,
                  color: m.past ? C.sub : C.ink,
                  backgroundColor: m.current ? C.wash : undefined,
                }}
              >
                <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-normal">
                  {monthLabel(m.key)}
                  {m.current && (
                    <span className="ml-2 text-label" style={{ color: C.faint }}>
                      This month
                    </span>
                  )}
                </th>
                <td className={cell}>
                  {fmtExact(m.grants)}
                  {m.overdue > 0 && (
                    <div className="text-label" style={{ color: C.danger }}>
                      incl. {fmtExact(m.overdue)} overdue
                    </div>
                  )}
                </td>
                {hasCoreCosts && <td className={cell}>{fmtExact(m.core)}</td>}
                {hasCoreCosts && (
                  <td className={`${cell} hidden font-medium sm:table-cell`}>
                    {fmtExact(m.total)}
                  </td>
                )}
                {hasIncome && (
                  <td className={cell} style={{ color: m.income > 0 ? C.success : undefined }}>
                    {fmtExact(m.income)}
                  </td>
                )}
                {balance && (
                  <td
                    className={cell}
                    style={{ color: m.closing !== null && m.closing < 0 ? C.danger : undefined }}
                  >
                    {m.closing === null ? '' : fmtExact(m.closing)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 font-display text-label" style={{ color: C.faint }}>
        <p>
          Grant payments are instalments paid in the month, or due and not yet paid
          {current ? `. Anything overdue is counted in ${monthLabel(current.key)}` : ''}.
          {hasCoreCosts &&
            ' Core costs follow your annual budget: monthly lines at each month end, quarterly at the end of each quarter (both from their start date, where they have one), one-offs on their date. They are your plan, not a record of what was paid.'}
          {hasIncome &&
            ' Income is placed the same way, and is your plan too: nothing here records what actually arrived.'}
        </p>
        {balance && (
          <p>
            The balance is projected from the reading: less grant payments made since{' '}
            {fmtDate(balance.asAtDate)}, every unpaid instalment due by {fmtDate(fy.end)}
            {hasCoreCosts ? ', and core costs scheduled after the reading' : ''}
            {hasIncome
              ? ', plus all income due after the reading, Fixed and Projected alike. Available balance counts Fixed income only'
              : ''}
            . Projected round budgets and contingency are not money leaving, so they are on the
            Summary tab only.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Where a manually-typed figure came from.
 *
 * Provenance rather than decoration: this is a number a board may act on, so who entered
 * it and when it was true belong on screen next to it.
 */
function BalanceNote({ balance }: { balance: NonNullable<Data['balance']> }) {
  return (
    <p className="font-display text-label" style={{ color: C.faint }}>
      Balance recorded by hand
      {balance.recordedBy ? ` by ${balance.recordedBy}` : ''}, as at {fmtDate(balance.asAtDate)}
      {balance.note ? `: “${balance.note}”` : ''}. Earlier readings are kept.
    </p>
  )
}
