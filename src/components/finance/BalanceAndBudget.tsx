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
  const { balance, budget, outstanding, financialYear: fy } = data
  const spare = balance ? headroom(balance.amount, outstanding) : null

  // `EmptyState` is full-bleed, which is right on a list screen where a table frames it.
  // Here it is the only thing on the page, so the card centres its own contents and the copy
  // is capped to a readable measure — uncapped, it ran the full width of the display as one
  // enormous line followed by a stub.
  if (data.empty) {
    return (
      <EmptyState className="flex justify-center">
        <p className="max-w-lg font-display text-body" style={{ color: C.sub }}>
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
    <EmptyState className="flex justify-center">
      <p className="max-w-lg font-display text-body" style={{ color: C.sub }}>
        No annual budget for this year.{' '}
        <TextLink to="/settings/budget">Set one in Settings</TextLink> to track what you have
        committed against what you planned to give.
      </p>
    </EmptyState>
  )
}
