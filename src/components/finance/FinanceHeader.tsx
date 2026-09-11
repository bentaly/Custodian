import { useNavigate } from '@tanstack/react-router'
import { Tabs } from '../ui'
import { C } from '../ui/tokens'

/**
 * The header both Finance screens wear — Payments and Balance & budget.
 *
 * Same shape as `ShortlistHeader`, and for the same reason: **the tabs are NAVIGATION,
 * not a filter.** Finance already has a tab pair inside its grants card (To pay / Paid)
 * which really is a filter over one list, so the two must not be confused — these sit up
 * in the page header with the `<h1>`, those sit on the card they cut.
 *
 * That distinction is why Balance & budget is a route rather than a third tab on the
 * grants card. It was first built as a large collapsible panel above the payments table,
 * which pushed the day's actual work — chasing payments — about 900px down the screen for
 * the sake of two figures that change quarterly. A foundation asks "can we cover what we
 * have promised?" before a board meeting, not every time it opens Finance.
 *
 * Both tabs are always offered. There was a switch hiding the second screen; it went on
 * 2026-09-11, because a foundation that records no balance and sets no budget already sees
 * an empty state, and a flag is one more thing to fall out of step with the data.
 */
export type FinanceTab = 'payments' | 'balance'

export function FinanceHeader({
  tab,
  subtitle,
  actions,
}: {
  tab: FinanceTab
  /** The screen's own one-line subtitle, under the title. */
  subtitle?: React.ReactNode
  /** This screen's own action, sat immediately left of the tabs — as Shortlist does it. */
  actions?: React.ReactNode
}) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          Finance
        </h1>
        {subtitle && (
          <p className="mt-0.5 font-display text-body" style={{ color: C.faint }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {actions}
        {
          <Tabs<FinanceTab>
            ariaLabel="Finance view"
            value={tab}
            items={[
              { id: 'payments', label: 'Payments' },
              { id: 'balance', label: 'Balance & budget' },
            ]}
            onChange={(next) =>
              next !== tab &&
              navigate({ to: next === 'payments' ? '/finance' : '/finance/balance' })
            }
          />
        }
      </div>
    </div>
  )
}
