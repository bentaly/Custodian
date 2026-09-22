import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { getBalanceAndBudget } from '../../server/fns/budget'
import { BalanceAndBudget, type BalanceView } from '../../components/finance/BalanceAndBudget'
import { BankBalanceDialog } from '../../components/finance/BankBalanceDialog'
import { FinanceHeader } from '../../components/finance/FinanceHeader'
import { GrantCreditorsDialog } from '../../components/finance/GrantCreditorsDialog'
import { Button } from '../../components/ui'
import { Download01Icon, PayByCheckIcon } from '@hugeicons/core-free-icons'

/**
 * Finance → Balance & budget.
 *
 * A route rather than a panel on the payments screen, and rather than a third tab on the
 * grants card — see `FinanceHeader` for why. Finance is now two routes wearing one header,
 * the same shape Shortlist uses, so the tabs stay honestly NAVIGATION while the To pay /
 * Paid pair inside the grants card stays honestly a filter.
 *
 * The Summary / Cash flow pair inside this screen's card is the other kind: two readings
 * of the same data, so it is a search param (a link, and the back button, keep it) with
 * no loader dependency — switching it never refetches.
 *
 * **Update balance lives here and only here.** It is the screen's own action, sat left of
 * the tabs as Shortlist puts its own. An earlier cut had it in two places at once — a
 * header button and a link inside the balance card — which is two things to keep in step
 * for one job.
 */
export const Route = createFileRoute('/_authenticated/finance/balance')({
  validateSearch: (search: Record<string, unknown>): { view?: 'cashflow' } => ({
    view: search.view === 'cashflow' ? 'cashflow' : undefined,
  }),
  loader: async () => {
    return { data: await getBalanceAndBudget() }
  },
  component: BalancePage,
})

function BalancePage() {
  const { data } = Route.useLoaderData()
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creditorsOpen, setCreditorsOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <FinanceHeader
        tab="balance"
        subtitle={data ? `Financial year ${data.financialYear.label}` : undefined}
        actions={
          <>
            {/* A download for the accountant, not a reading of this screen, so it sits
                beside the screen's own action rather than inside the Summary card. */}
            {data && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCreditorsOpen(true)}
                icon={Download01Icon}
                iconPosition="right"
              >
                Grant creditors
              </Button>
            )}
            <Button
              variant="tinted"
              size="sm"
              onClick={() => setDialogOpen(true)}
              icon={PayByCheckIcon}
              iconPosition="right"
            >
              {data?.balance ? 'Update balance' : 'Record balance'}
            </Button>
          </>
        }
      />

      {data && (
        <BalanceAndBudget
          data={data}
          view={view ?? 'summary'}
          onViewChange={(next: BalanceView) =>
            navigate({ search: { view: next === 'cashflow' ? 'cashflow' : undefined } })
          }
        />
      )}

      <BankBalanceDialog
        open={dialogOpen}
        previous={data?.balance ?? null}
        onClose={() => setDialogOpen(false)}
        onSaved={() => router.invalidate()}
      />

      {data && (
        <GrantCreditorsDialog
          open={creditorsOpen}
          currentYearEnd={data.financialYear.end}
          onClose={() => setCreditorsOpen(false)}
        />
      )}
    </div>
  )
}
