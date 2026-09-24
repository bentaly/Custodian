import { Calendar03Icon, CoinsPoundIcon, CreditCardIcon } from '@hugeicons/core-free-icons'
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
 * The same pieces as Payments: headline cards on top (Balance, Projected spend, Available
 * balance — tinted by place in the row, violet then green then amber, as `KPI_TINTS` says),
 * then one card holding a tab pair and the table under it. Summary is the reconciliation,
 * Cash flow the month table. The six stat cards and per-programme meters this replaced read
 * as a different screen bolted on, and cards cannot carry a line with more than one figure.
 *
 * ## The summary's columns
 *
 * **Actual**, **Projected**, **Still to pay** — money gone, money planned, money owed. The
 * footer works from the balance down to Available balance so it can be checked by
 * subtraction. A figure a line cannot have (a contingency is never paid) reads "n/a",
 * which is not the same statement as £0. The rules are `src/lib/balanceSummary.ts`.
 *
 * ## Each half stands alone
 *
 * No balance drops the cards and the footer's arithmetic, since both mean nothing without
 * one; the three columns still stand. No budget drops core costs and contingency; grants
 * and round budgets still show.
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
  const { balance, summary, financialYear: fy } = data

  if (data.empty) {
    return (
      <EmptyState>
        <p className="font-display text-body" style={{ color: C.sub }}>
          Nothing recorded yet. Use <span className="font-medium">Record balance</span> to enter
          what is in the bank, or <TextLink to="/settings/budget">set an annual budget</TextLink> to
          plan the year&rsquo;s giving and costs. Either works on its own.
        </p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {balance &&
        summary.available !== null &&
        summary.deducted !== null && (
          // Three cards that read as a sum: balance − projected spend = available. Projected
          // spend is what the summary's footer takes off the balance, so the table checks it.
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniKpi
              tint={KPI_TINTS.violet}
              icon={CreditCardIcon}
              label="Balance"
              value={fmtExact(balance.amount)}
              // The as-at date is part of the number, not metadata about it — a balance
              // without the day it was true is not something anybody can act on.
              sub={
                balance.stale
                  ? `As at ${fmtDate(balance.asAtDate)} · ${balance.daysOld} days old`
                  : `As at ${fmtDate(balance.asAtDate)}`
              }
              subColour={balance.stale ? C.warning : undefined}
            />
            <MiniKpi
              tint={KPI_TINTS.green}
              icon={Calendar03Icon}
              label="Projected spend"
              value={fmtExact(summary.deducted)}
              sub={
                summary.contingency
                  ? `By ${fmtDate(fy.end)}, incl. ${fmtExact(summary.contingency.amount)} contingency`
                  : `Still to come out by ${fmtDate(fy.end)}`
              }
            />
            <MiniKpi
              tint={KPI_TINTS.amber}
              icon={CoinsPoundIcon}
              label="Available balance"
              value={fmtExact(summary.available)}
              valueColour={summary.available < 0 ? C.danger : undefined}
              sub="Balance less projected spend"
            />
          </div>
        )}

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
  actual: number | null
  projected: number | null
  stillToPay: number | null
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
  }
}

/** Which figures a line can have at all. */
const HAS = {
  core: { actual: true, projected: true, stillToPay: false },
  prior: { actual: true, projected: false, stillToPay: true },
  current: { actual: true, projected: true, stillToPay: true },
  contingency: { actual: false, projected: true, stillToPay: false },
} as const

function Summary({ data }: { data: Data }) {
  const { balance, summary, financialYear: fy } = data

  if (summary.lines.length === 0) {
    return (
      <p className="py-6 text-center font-display text-body" style={{ color: C.faint }}>
        Nothing awarded, budgeted or held in a round for {fy.label} yet.
      </p>
    )
  }

  const figures = (
    kind: SummaryLineKind,
    f: { actual: number; projected: number; stillToPay: number },
  ) => ({
    actual: HAS[kind].actual ? f.actual : null,
    projected: HAS[kind].projected ? f.projected : null,
    stillToPay: HAS[kind].stillToPay ? f.stillToPay : null,
  })

  const rows: BreakdownRow<Item>[] = summary.lines.map((line) => ({
    key: line.kind,
    data: {
      name: lineName(line.kind, fy.label),
      hint: lineHint(line, data),
      ...figures(line.kind, line),
    },
    children: line.children.map((child, i) => ({
      key: child.key,
      data: {
        name: child.name,
        // Core-cost lines are not programmes and have no colour of their own.
        colour: line.kind === 'core' ? undefined : resolveProgrammeColour(child.colour, i),
        over: child.over,
        ...figures(line.kind, child),
      },
    })),
  }))

  const money = (n: number | null, colour?: string) =>
    n === null ? (
      <span style={{ color: C.faint }}>n/a</span>
    ) : (
      <span style={{ color: colour }}>{fmtExact(n)}</span>
    )

  const column = (id: keyof typeof HAS.core, header: string): BreakdownColumn<Item> => ({
    id,
    header,
    cell: (r) => money(r[id], r.over ? C.danger : undefined),
  })
  const columns = [
    column('actual', 'Actual'),
    column('projected', 'Projected'),
    column('stillToPay', 'Still to pay'),
  ]

  // Same spacing as the figure columns above (`BreakdownTable`): extra room after every
  // column but the last, which is where the balance arithmetic sits.
  const footCell = 'py-3 pl-3 pr-10 text-left tabular-nums whitespace-nowrap'
  const footLast = 'px-3 py-3 text-left tabular-nums whitespace-nowrap'
  const footLabel = 'py-3 pl-8 pr-3 text-left'
  const since = summary.sinceBalance
  const footer = (
    <>
      <tr className="border-t font-medium" style={{ borderColor: C.line, color: C.ink }}>
        <th scope="row" className={`${footLabel} font-medium`}>
          Total
        </th>
        <td className={footCell}>{fmtExact(summary.total.actual)}</td>
        <td className={footCell}>{fmtExact(summary.total.projected)}</td>
        <td className={footLast}>{fmtExact(summary.total.stillToPay)}</td>
      </tr>
      {/* From the balance down to what is available, one term per row, so the card above
          can be checked by subtraction. */}
      {balance && since && summary.available !== null && (
        <>
          <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
            <th scope="row" colSpan={3} className={`${footLabel} font-normal`}>
              Balance as at {fmtDate(balance.asAtDate)}
            </th>
            <td className={footLast}>{fmtExact(balance.amount)}</td>
          </tr>
          <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
            <th scope="row" colSpan={3} className={`${footLabel} font-normal`}>
              Less projected and still to pay
            </th>
            <td className={footLast}>
              {fmtExact(summary.total.projected + summary.total.stillToPay)}
            </td>
          </tr>
          {since.total > 0 && (
            <tr className="border-t" style={{ borderColor: C.line, color: C.sub }}>
              <th scope="row" colSpan={3} className={`${footLabel} font-normal`}>
                Less actual spend since {fmtDate(balance.asAtDate)}, not yet in that balance
              </th>
              <td className={footLast}>{fmtExact(since.total)}</td>
            </tr>
          )}
          <tr className="border-t font-medium" style={{ borderColor: C.line, color: C.ink }}>
            <th scope="row" colSpan={3} className={`${footLabel} font-medium`}>
              Available balance
            </th>
            <td
              className={footLast}
              style={{ color: summary.available < 0 ? C.danger : C.success }}
            >
              {fmtExact(summary.available)}
            </td>
          </tr>
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
  const { cashFlow, balance, hasCoreCosts, financialYear: fy } = data
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
            ' Core costs follow your annual budget: monthly lines at each month end, one-offs on their date. They are your plan, not a record of what was paid.'}
        </p>
        {balance && (
          <p>
            The balance is projected from the reading: less grant payments made since{' '}
            {fmtDate(balance.asAtDate)}, every unpaid instalment due by {fmtDate(fy.end)}
            {hasCoreCosts ? ', and core costs scheduled after the reading' : ''}. Projected round
            budgets and contingency are not money leaving, so they are on the Summary tab only.
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
