import {
  Calendar03Icon,
  CoinsPoundIcon,
  CreditCardIcon,
  Wallet03Icon,
} from '@hugeicons/core-free-icons'
import type { BalanceAndBudget as Data } from '../../server/finance/budget'
import { headroom } from '../../lib/annualBudget'
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
  const { balance, budget, cash, outstanding, financialYear: fy } = data
  const spare = balance ? headroom(balance.amount, outstanding) : null

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
      <Stats balance={balance} budget={budget} outstanding={outstanding} spare={spare} fy={fy} />
      {budget ? <BudgetPanel budget={budget} spare={spare} fy={fy} /> : <NoBudget />}
      {/* The cash view sits UNDER the commitment one, not beside it. The commitment
          figures are the accounts basis and the ones a foundation is asked for; this
          answers the question that basis cannot — what this year actually has to pay, and
          what is genuinely free to give. Below rather than above because a reader coming
          to Finance wants the familiar figure first, and only then the reconciliation.
          Drawn only when there is a multi-year grant to reconcile: with every grant paid
          inside its own year the two views are identical, and printing both would be the
          same numbers twice with two different headings. */}
      {cash && budget && <CashPanel cash={cash} budget={budget} fy={fy} />}
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
  outstanding,
  spare,
  fy,
}: {
  balance: Data['balance']
  budget: Data['budget']
  outstanding: Data['outstanding']
  spare: number | null
  fy: Data['financialYear']
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {balance && (
        <MiniKpi
          tint={balance.stale ? KPI_TINTS.amber : KPI_TINTS.green}
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
          tint={KPI_TINTS.violet}
          icon={CoinsPoundIcon}
          label="Annual budget"
          value={fmtMoney(budget.total)}
          sub={`${fmtMoney(budget.used)} committed${
            budget.total > 0 ? ` · ${Math.round((budget.used / budget.total) * 100)}%` : ''
          }`}
        />
      )}
      {budget && (
        <MiniKpi
          tint={KPI_TINTS.sky}
          icon={Wallet03Icon}
          label="Paid this year"
          value={fmtMoney(budget.paid)}
          sub={`${fmtMoney(Math.max(0, budget.used - budget.paid))} committed, not yet paid`}
        />
      )}
      {balance && (
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={Calendar03Icon}
          label="Left after this year"
          value={fmtMoney(spare!)}
          valueColour={spare! < 0 ? C.danger : C.success}
          // The point of the whole screen: cash is set against what falls due INSIDE the
          // year, never against every penny outstanding. Years two and three of a
          // multi-year grant are not paid out of today's balance, and setting the two
          // against each other would show a healthy foundation a frightening number.
          sub={
            outstanding.dueLater > 0
              ? `${fmtMoney(outstanding.dueByYearEnd)} due by ${fmtDate(fy.end)} · ${fmtMoney(outstanding.dueLater)} in later years`
              : `${fmtMoney(outstanding.dueByYearEnd)} due by ${fmtDate(fy.end)}`
          }
        />
      )}
    </div>
  )
}

function BudgetPanel({
  budget,
  spare,
  fy,
}: {
  budget: NonNullable<Data['budget']>
  spare: number | null
  fy: Data['financialYear']
}) {
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
        {budget.lines.map((line, i) => {
          // A non-grant line is not a programme and must not borrow a programme's hue —
          // the palette is how a foundation recognises its programmes across the app.
          const colour = line.programmeId
            ? resolveProgrammeColour(line.colour, i)
            : 'var(--color-grey-400)'
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
            </div>
          )
        })}
      </div>

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

/**
 * Where a manually-typed figure came from.
 *
 * Provenance rather than decoration: this is a number a board may act on, so who entered
 * it and when it was true belong on screen next to it.
 */
/**
 * The year on a cash basis: what is already promised, what is free, what has been drawn.
 *
 * ## Why this exists beside the panel above
 *
 * `BudgetPanel` counts DECISIONS at their full multi-year value — a three-year £90,000
 * grant consumes £90,000 of the year it was decided in, which is how charity SORP
 * recognises it and what the signed accounts say. That is right, and it cannot answer the
 * question a foundation asks when it sets a new round's budget: *how much of this year's
 * money is already spoken for, and what is left to give?* Years two and three of last
 * year's grants are not in the accounts figure for this year at all, and they are the
 * first call on this year's cash.
 *
 * So: `promised` is cash owed this year against grants decided in earlier years,
 * `allocated` is cash owed this year against grants decided in this one, and `free` is
 * the budget less the promised — the figure round budgets are carved out of.
 *
 * ## Where a foundation overrode us
 *
 * `promised` is derived from the instalment dates Custodian already holds, so it needs
 * nothing typed to be right. A finance lead can still state their own figure — a
 * contingency buffer, or a grant whose future instalments they treat differently — and
 * where they have, both numbers are printed. An override has to read as a deliberate
 * choice against a figure still on screen, not as a correction to one that vanished.
 */
function CashPanel({
  cash,
  budget,
  fy,
}: {
  cash: NonNullable<Data['cash']>
  budget: NonNullable<Data['budget']>
  fy: Data['financialYear']
}) {
  // Nothing to reconcile when every grant is paid inside the year it was decided: the two
  // views agree to the penny and the second heading would be the only new information.
  const reconciles = Math.abs(budget.used - (cash.promised + cash.allocated)) < 0.005
  if (cash.lines.length === 0 || reconciles) return null

  return (
    <Panel label="This year's cash">
      <PanelTitle>
        Free to give <span style={{ color: C.faint }}>· {fy.label}</span>
      </PanelTitle>
      {/* The one sentence this panel needs, because its figures look like the ones above
          and count something else. Under the title rather than in it: a title carrying two
          clauses stops being a title. */}
      <p className="-mt-1 font-display text-label" style={{ color: C.faint }}>
        The panel above counts whole commitments, which is the accounts figure. This counts only the
        instalments falling due inside {fy.label}.
      </p>

      <div className="flex flex-col gap-3.5">
        {cash.lines.map((line, i) => {
          const colour = resolveProgrammeColour(line.colour, i)
          const over = line.unallocated < 0
          return (
            <div key={line.programmeId} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Swatch colour={colour} square />
                  <span className="truncate font-display text-body" style={{ color: C.body }}>
                    {line.name}
                  </span>
                </span>
                <span className="shrink-0 font-display text-body font-medium tabular-nums text-grey-900">
                  {fmtMoney(line.free)}
                  <span style={{ color: C.faint }}> free of {fmtMoney(line.budget)}</span>
                </span>
              </div>
              {/* The same bar as the budget meter, measuring the other thing: what earlier
                  years already claim of this programme's allocation, then what this year's
                  own decisions have drawn on top. */}
              <Meter
                paid={line.promised}
                used={line.promised + line.allocated}
                total={line.budget}
                colour={colour}
                delay={i * 90}
              />
              <div
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-display text-label"
                style={{ color: C.faint }}
              >
                <span>
                  {fmtMoney(line.promised)} promised from earlier years
                  {line.allocated > 0 && <> · {fmtMoney(line.allocated)} drawn this year</>}
                  {/* Both figures, where they differ. A buffer is a policy decision and
                      the screen should name it rather than let it surface as a figure that
                      quietly disagrees with the grants behind it. */}
                  {line.overridden && (
                    <span style={{ color: C.amber }}>
                      {' '}
                      · stated, vs {fmtMoney(line.promisedDerived)} from the schedules
                    </span>
                  )}
                </span>
                {over && (
                  <span style={{ color: C.danger }}>
                    {fmtMoney(-line.unallocated)} more drawn than was free
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* The reconciliation, stated rather than smoothed over: the two panels count the
          same decisions on two bases and a reader who adds one up and compares it with the
          other must find the difference explained. It is not an error — it is the value of
          the years beyond this one, which is exactly what multi-year giving means. */}
      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 font-display text-body"
        style={{ borderColor: C.line, color: C.sub }}
      >
        <span>
          Committed in {fy.label} across all years
          <span style={{ color: C.faint }}> · the figure in the panel above</span>
        </span>
        <span className="font-medium tabular-nums" style={{ color: C.ink }}>
          {fmtMoney(budget.used)}
          <span style={{ color: C.faint }}>
            {' '}
            · {fmtMoney(cash.promised + cash.allocated)} falls due this year
          </span>
        </span>
      </div>
    </Panel>
  )
}

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
