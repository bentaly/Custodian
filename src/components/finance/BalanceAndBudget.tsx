import {
  Calendar03Icon,
  CoinsPoundIcon,
  CreditCardIcon,
  Wallet03Icon,
} from '@hugeicons/core-free-icons'
import type { BalanceAndBudget as Data } from '../../server/finance/budget'
import { MONTH_NAMES } from '../../lib/financialYear'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { fmtDate, fmtMoney } from '../../lib/format'
import { ProgressBar } from '../ProgressBar'
import { C } from '../ui/tokens'
import { EmptyState, KPI_TINTS, MiniKpi, Panel, PanelTitle, TextLink } from '../ui'

/**
 * The Balance & budget screen — Finance's second route.
 *
 * Answers one question with two numbers a foundation cannot otherwise put together:
 * **can we cover what we have promised, and are we spending the year the way we planned?**
 *
 * ## Why it is a screen and not a panel
 *
 * It was first built as a collapsible panel above the payments table, which is how the
 * rendered comp has it. That put a quarterly question permanently on top of a daily one:
 * the grants table started ~900px down, and the meters were squeezed into whatever was
 * left beside a 340px cash card. The comp's own source carries the alternative — an
 * unwired third tab and an unused four-stat array — and this screen is those two ideas
 * finished: the stat row across the top, the meters full width beneath it.
 *
 * ## What the meters mean
 *
 * These bars look like the dashboard's round meters and count something different. There,
 * "committed" is the pipeline — shortlisted OR awarded — because that panel is about a
 * round filling up. Here it is Finance's: awarded, cancelled excluded, because an annual
 * budget is consumed by decisions. A bar that moved when somebody shortlisted an
 * application would tell a trustee they had spent money they had not committed.
 *
 * ## Each half stands alone
 *
 * Budget with no balance drops the cash stats and the headroom figure, which is
 * meaningless without one; balance with no budget shows the cash alone. Neither is
 * required, and the whole screen is hidden by a switch in Settings that touches no data.
 */

const trackFor = (colour: string) => `color-mix(in srgb, ${colour} 16%, #fff)`
const midFor = (colour: string) => `color-mix(in srgb, ${colour} 45%, #fff)`

/**
 * The budget meter — paid, then committed-not-yet-paid, then the rest.
 *
 * The same bar the dashboard draws for a round's programmes: one rounded track in the
 * programme's own hue, filled left to right. It carries a second band the dashboard's
 * does not, because here what has actually LEFT the account is a different fact from
 * what the year has committed.
 */
function Meter({
  paid,
  used,
  total,
  colour,
  delay,
}: {
  paid: number
  used: number
  total: number
  colour: string
  delay: number
}) {
  // An overspent line fills the bar completely — the overspend is stated in words beneath
  // it, and a bar drawn past its own end just looks like a rendering fault.
  const span = Math.max(total, used) || 1

  return (
    <ProgressBar
      className="my-1"
      track={trackFor(colour)}
      segments={[
        { value: paid / span, colour },
        { value: Math.max(0, used - paid) / span, colour: midFor(colour) },
      ]}
      delay={delay}
    />
  )
}

function Swatch({ colour, square = false }: { colour: string; square?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${square ? 'h-2 w-2 rounded-[2px]' : 'h-1.5 w-1.5 rounded-full'}`}
      style={{ backgroundColor: colour }}
    />
  )
}

export function BalanceAndBudget({ data }: { data: Data }) {
  const { balance, budget, cash, outstanding, coreCosts, cashFlow, financialYear: fy } = data
  // Measured from the day the balance was true, core costs included — see `buildCashFlow`.
  // The cash flow table's last closing balance is this same figure.
  const spare = cashFlow.headroom

  if (data.empty) {
    return (
      <EmptyState>
        <p className="font-display text-body" style={{ color: C.sub }}>
          Nothing recorded yet. Use <span className="font-medium">Record balance</span> to enter
          what is in the bank, or <TextLink to="/settings/budget">set an annual budget</TextLink> to
          track your giving against the year&rsquo;s plan. Either works on its own.
        </p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Stats
        balance={balance}
        budget={budget}
        cash={cash}
        sinceBalance={cashFlow.sinceBalance}
        spare={spare}
        fy={fy}
      />
      {budget ? (
        <BudgetPanel budget={budget} cash={cash} coreCosts={coreCosts} spare={spare} fy={fy} />
      ) : (
        <NoBudget />
      )}
      <CashFlowPanel
        cashFlow={cashFlow}
        balance={balance}
        hasCoreCosts={coreCosts !== null}
        undated={outstanding.undated}
        fy={fy}
      />
      {balance && <BalanceNote balance={balance} />}
    </div>
  )
}

/**
 * The stat row — the four figures the comp's unused `stats` array named.
 *
 * Only the cards that have an answer are drawn. A row that filled the gaps with dashes
 * would say "we could not work this out" about numbers the foundation simply has not
 * given us.
 */
function Stats({
  balance,
  budget,
  cash,
  sinceBalance,
  spare,
  fy,
}: {
  balance: Data['balance']
  budget: Data['budget']
  cash: Data['cash']
  sinceBalance: Data['cashFlow']['sinceBalance']
  spare: number | null
  fy: Data['financialYear']
}) {
  // The two cash cards only earn their place where a multi-year grant makes cash and
  // commitment differ. On a portfolio paid inside its own year they would be the annual
  // budget card restated twice.
  const showCash =
    cash !== null && Math.abs((budget?.used ?? 0) - (cash.promised + cash.allocated)) >= 0.005

  /**
   * The widest row that divides the cards evenly, so the last row is never a short one.
   *
   * The count varies from one to six with what the foundation has recorded, and a fixed
   * four-across left six cards as a row of four and a row of two — which reads as a card
   * missing rather than as a grid. Three across gives six two clean rows of three, and
   * four across gives four a single row.
   */
  const count = (balance ? 2 : 0) + (budget ? 2 : 0) + (showCash ? 2 : 0)
  const wide =
    count % 4 === 0 ? 'xl:grid-cols-4' : count % 3 === 0 ? 'xl:grid-cols-3' : 'xl:grid-cols-2'
  // A tint is the card's place in the row, not a state (`KPI_TINTS`), and which cards
  // show varies with the data — so each card takes the next tint as it renders rather
  // than owning one. A stale balance says so in its sub line; the card stays its colour.
  const tints = Object.values(KPI_TINTS)
  let place = 0
  const nextTint = () => tints[place++ % tints.length]!
  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${wide}`}>
      {balance && (
        <MiniKpi
          tint={nextTint()}
          icon={CreditCardIcon}
          label="Bank balance"
          value={fmtMoney(balance.amount)}
          // The as-at date is part of the number, not metadata about it — a balance
          // without the day it was true is not something anybody can act on.
          sub={
            balance.stale
              ? `As at ${fmtDate(balance.asAtDate)} · ${balance.daysOld} days old`
              : `As at ${fmtDate(balance.asAtDate)}`
          }
          subColour={balance.stale ? C.warning : undefined}
        />
      )}
      {budget && (
        <MiniKpi
          tint={nextTint()}
          icon={CoinsPoundIcon}
          label="Annual budget"
          value={fmtMoney(budget.total)}
          sub={`${fmtMoney(budget.used)} committed${
            budget.total > 0 ? ` · ${Math.round((budget.used / budget.total) * 100)}%` : ''
          }`}
        />
      )}
      {/* What the year actually has to find, and what is left to give out of it — the
          question the annual budget card above cannot answer, because that one counts
          whole multi-year commitments. Placed directly after it so the two readings of
          the same year sit together. */}
      {showCash && (
        <MiniKpi
          tint={nextTint()}
          icon={Calendar03Icon}
          label={`Due in ${fy.label}`}
          value={fmtMoney(cash.promised + cash.allocated)}
          sub={
            cash.promised > 0
              ? `${fmtMoney(cash.promised)} promised before this year`
              : 'All from decisions made this year'
          }
        />
      )}
      {showCash && (
        <MiniKpi
          tint={nextTint()}
          icon={CoinsPoundIcon}
          label="Available grant spend"
          value={fmtMoney(cash.free)}
          valueColour={cash.free > 0 ? C.success : C.danger}
          sub={`Of ${fmtMoney(cash.budget)} budgeted, after prior commitments`}
        />
      )}
      {budget && (
        <MiniKpi
          tint={nextTint()}
          icon={Wallet03Icon}
          label="Paid this year"
          value={fmtMoney(budget.paid)}
          sub={`${fmtMoney(Math.max(0, budget.used - budget.paid))} committed, not yet paid`}
        />
      )}
      {balance && (
        <MiniKpi
          tint={nextTint()}
          icon={Calendar03Icon}
          label="Left after this year"
          value={fmtMoney(spare!)}
          valueColour={spare! < 0 ? C.danger : C.success}
          // The point of the whole screen: cash is set against what falls due INSIDE the
          // year, never against every penny outstanding. Years two and three of a
          // multi-year grant are not paid out of today's balance, and setting the two
          // against each other would show a healthy foundation a frightening number.
          // Every term between the balance and this figure is named, so the card can be
          // checked by subtraction — including payments made since the reading.
          sub={leftAfterYearSub(sinceBalance, fy.end)}
        />
      )}
    </div>
  )
}

function BudgetPanel({
  budget,
  cash,
  coreCosts,
  spare,
  fy,
}: {
  budget: NonNullable<Data['budget']>
  cash: Data['cash']
  coreCosts: Data['coreCosts']
  spare: number | null
  fy: Data['financialYear']
}) {
  // Each programme appears ONCE. The commitment figures and the cash figures are two
  // readings of the same programme's year, and as two panels they made a reader scroll
  // between two lists to put one programme's numbers together — and read as two different
  // sets of programmes at a glance.
  const cashByProgramme = new Map((cash?.lines ?? []).map((l) => [l.programmeId, l]))
  const programmeLines = budget.lines.filter((l) => l.programmeId)
  const costLines = budget.lines.filter((l) => !l.programmeId)
  return (
    <Panel label="Annual budget">
      <PanelTitle
        right={
          <div
            className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-display text-label"
            style={{ color: C.faint }}
          >
            {/* Each chip is one unbreakable unit — the legend read as three stacked pairs
                when the panel was narrow, which looks like six figures rather than three. */}
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Swatch colour="var(--color-grey-700)" /> Paid {fmtMoney(budget.paid)}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Swatch colour="var(--color-grey-400)" /> Committed {fmtMoney(budget.used)}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Swatch colour="var(--color-grey-300)" /> Remaining {fmtMoney(budget.remaining)}
            </span>
          </div>
        }
      >
        By programme <span style={{ color: C.faint }}>· {budget.label}</span>
      </PanelTitle>

      <div className="flex flex-col gap-3.5">
        {programmeLines.map((line, i) => {
          const colour = resolveProgrammeColour(line.colour, i)
          const over = line.remaining < 0
          return (
            <div key={line.programmeId ?? `core-${i}`} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Swatch colour={colour} square />
                  <span className="truncate font-display text-body" style={{ color: C.body }}>
                    {line.name}
                  </span>
                </span>
                <span className="shrink-0 font-display text-body font-medium tabular-nums text-grey-900">
                  {fmtMoney(line.used)}
                  <span style={{ color: C.faint }}>/{fmtMoney(line.budget)}</span>
                </span>
              </div>
              <Meter
                paid={line.paid}
                used={line.used}
                total={line.budget}
                colour={colour}
                delay={i * 90}
              />
              <div
                className="flex items-baseline justify-between gap-3 font-display text-label"
                style={{ color: C.faint }}
              >
                <span>
                  {fmtMoney(line.paid)} paid · {fmtMoney(Math.max(0, line.used - line.paid))}{' '}
                  committed, not yet paid
                </span>
                <span style={{ color: over ? C.danger : C.faint }}>
                  {over
                    ? `${fmtMoney(-line.remaining)} over budget`
                    : `${fmtMoney(line.remaining)} unallocated`}
                </span>
              </div>
              {/* The same programme's year in CASH, under its year in commitments. The
                  meter above counts whole multi-year commitments, which is the accounts
                  basis; this states what actually falls due inside the year, which is what
                  a round's budget is carved out of. Only where a multi-year grant makes
                  the two differ — otherwise it would be the same figure with a second
                  label, on every row. */}
              {(() => {
                const c = line.programmeId ? cashByProgramme.get(line.programmeId) : undefined
                if (!c || Math.abs(line.used - (c.promised + c.allocated)) < 0.005) return null
                return (
                  <div
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-1.5 font-display text-label"
                    style={{ borderColor: C.line, color: C.faint }}
                  >
                    <span>
                      Due this year: {fmtMoney(c.promised + c.allocated)}
                      {c.promised > 0 && <> · {fmtMoney(c.promised)} from earlier years</>}
                      {/* Both figures where a finance lead overrode ours, because a buffer
                          is a policy decision and should read as one. */}
                      {c.overridden && (
                        <span style={{ color: C.amber }}>
                          {' '}
                          · stated, vs {fmtMoney(c.promisedDerived)} from the schedules
                        </span>
                      )}
                    </span>
                    <span style={{ color: c.free > 0 ? C.success : C.faint }}>
                      {fmtMoney(c.free)} available grant spend
                    </span>
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* Core costs are the plan placed through the year, not money Custodian saw leave,
          so they sit apart from the grant meters and say "by schedule" rather than "paid".
          The legend above is about grants and does not describe these bars. */}
      {costLines.length > 0 && coreCosts && (
        <CoreCostsSection
          lines={costLines}
          plan={coreCosts}
          startDelay={programmeLines.length * 90}
        />
      )}

      {spare !== null && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 font-display text-body"
          style={{ borderColor: C.line, color: C.sub }}
        >
          <span>
            {spare >= 0
              ? `The balance covers everything due by ${fmtDate(fy.end)}`
              : `Payments due by ${fmtDate(fy.end)} exceed the balance`}
          </span>
          <span
            className="font-medium tabular-nums"
            style={{ color: spare >= 0 ? C.success : C.danger }}
          >
            {spare >= 0 ? `${fmtMoney(spare)} to spare` : `${fmtMoney(-spare)} short`}
          </span>
        </div>
      )}
    </Panel>
  )
}

/** The "Left after this year" card's sub line: every term between the balance and it. */
function leftAfterYearSub(since: Data['cashFlow']['sinceBalance'], end: string): string {
  if (!since) return ''
  const due = [
    `${fmtMoney(since.dueGrants)} grants`,
    since.core > 0 && `${fmtMoney(since.core)} core costs`,
  ]
    .filter(Boolean)
    .join(' and ')
  const lead = since.paidGrants > 0 ? `${fmtMoney(since.paidGrants)} paid since the reading · ` : ''
  return `${lead}${due} due by ${fmtDate(end)}`
}

/**
 * The non-grant lines, each with a meter filled by its SCHEDULE.
 *
 * A monthly line fills a twelfth at each month end, a one-off fills on its date. Before
 * frequency existed these meters could only ever read £0, because nothing records rent
 * leaving the account — which drew every core cost as untouched all year.
 */
function CoreCostsSection({
  lines,
  plan,
  startDelay,
}: {
  lines: NonNullable<Data['budget']>['lines']
  plan: NonNullable<Data['coreCosts']>
  startDelay: number
}) {
  const colour = 'var(--color-grey-400)'
  const summary = [
    plan.perMonth > 0 && `${fmtMoney(plan.perMonth)} a month`,
    plan.oneOff > 0 && `${fmtMoney(plan.oneOff)} one-off`,
  ]
    .filter(Boolean)
    .join(' + ')
  return (
    <div className="mt-5 flex flex-col gap-3.5 border-t pt-4" style={{ borderColor: C.line }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-display">
        <span className="text-body font-medium" style={{ color: C.ink }}>
          Core and other costs
        </span>
        <span className="text-label" style={{ color: C.faint }}>
          {summary}
        </span>
      </div>
      {lines.map((line, i) => {
        // The same rows in the same order: both are the budget's non-grant lines as stored.
        const p = plan.lines[i]
        if (!p) return null
        return (
          <div key={`core-${i}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <Swatch colour={colour} square />
                <span className="truncate font-display text-body" style={{ color: C.body }}>
                  {line.name}
                </span>
              </span>
              <span className="shrink-0 font-display text-body font-medium tabular-nums text-grey-900">
                {fmtMoney(p.toDate)}
                <span style={{ color: C.faint }}>/{fmtMoney(p.amount)}</span>
              </span>
            </div>
            <Meter
              paid={p.toDate}
              used={p.toDate}
              total={p.amount}
              colour={colour}
              delay={startDelay + i * 90}
            />
            <div
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-display text-label"
              style={{ color: C.faint }}
            >
              <span>
                {p.frequency === 'monthly'
                  ? `${fmtMoney(p.perMonth ?? 0)} a month · ${fmtMoney(p.toDate)} to date by schedule`
                  : `One-off, ${fmtDate(p.dueDate)}${p.toDate > 0 ? ' · now due' : ''}`}
              </span>
              <span>{p.toCome > 0 ? `${fmtMoney(p.toCome)} still to come` : 'All due'}</span>
            </div>
          </div>
        )
      })}
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
 * spreadsheet, figure by figure. The closing balance ends on exactly the "Left after this
 * year" card, because both are the same sum (`buildCashFlow`).
 */
function CashFlowPanel({
  cashFlow,
  balance,
  hasCoreCosts,
  undated,
  fy,
}: {
  cashFlow: Data['cashFlow']
  balance: Data['balance']
  hasCoreCosts: boolean
  undated: number
  fy: Data['financialYear']
}) {
  const { months } = cashFlow
  if (!balance && !months.some((m) => m.total !== 0)) return null
  const current = months.find((m) => m.current)
  const cell = 'px-2 py-2 text-right'
  return (
    <Panel label="Cash flow">
      <PanelTitle
        right={
          balance && (
            <span className="font-display text-label" style={{ color: C.faint }}>
              From {fmtMoney(balance.amount)} as at {fmtDate(balance.asAtDate)}
            </span>
          )
        }
      >
        Cash flow <span style={{ color: C.faint }}>· {fy.label}</span>
      </PanelTitle>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-display text-body tabular-nums">
          <thead>
            <tr className="text-label" style={{ color: C.faint }}>
              <th scope="col" className="px-2 py-2 text-left font-medium">
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
                  {fmtMoney(m.grants)}
                  {m.overdue > 0 && (
                    <div className="text-label" style={{ color: C.danger }}>
                      incl. {fmtMoney(m.overdue)} overdue
                    </div>
                  )}
                </td>
                {hasCoreCosts && <td className={cell}>{fmtMoney(m.core)}</td>}
                {hasCoreCosts && (
                  <td className={`${cell} hidden font-medium sm:table-cell`}>
                    {fmtMoney(m.total)}
                  </td>
                )}
                {balance && (
                  <td
                    className={cell}
                    style={{ color: m.closing !== null && m.closing < 0 ? C.danger : undefined }}
                  >
                    {m.closing === null ? '' : fmtMoney(m.closing)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-1 font-display text-label" style={{ color: C.faint }}>
        <p>
          Grant payments are instalments paid in the month, or due and not yet paid
          {current ? ` — anything overdue is counted in ${monthLabel(current.key)}` : ''}.
          {hasCoreCosts &&
            ' Core costs follow your annual budget: monthly lines at each month end, one-offs on their date. They are your plan, not a record of what was paid.'}
        </p>
        {undated > 0 && (
          <p>{fmtMoney(undated)} of instalments have no date yet, so no month to show them in.</p>
        )}
        {balance && (
          <p>
            The balance is projected from the reading: less grant payments made since{' '}
            {fmtDate(balance.asAtDate)}, every unpaid instalment due by {fmtDate(fy.end)}
            {hasCoreCosts ? ', and core costs scheduled after the reading' : ''}.
          </p>
        )}
      </div>
    </Panel>
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
      Bank balance recorded by hand
      {balance.recordedBy ? ` by ${balance.recordedBy}` : ''}, as at {fmtDate(balance.asAtDate)}
      {balance.note ? ` — “${balance.note}”` : ''}. Earlier readings are kept.
    </p>
  )
}

/** Balance recorded, no budget set. */
function NoBudget() {
  return (
    <EmptyState>
      <p className="font-display text-body" style={{ color: C.sub }}>
        No annual budget for this year.{' '}
        <TextLink to="/settings/budget">Set one in Settings</TextLink> to track what you have
        committed against what you planned to give.
      </p>
    </EmptyState>
  )
}
