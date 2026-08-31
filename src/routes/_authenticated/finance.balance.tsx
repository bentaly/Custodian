import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { getBalanceAndBudget, getFinanceNav } from '../../server/fns/budget'
import { BalanceAndBudget } from '../../components/finance/BalanceAndBudget'
import { BankBalanceDialog } from '../../components/finance/BankBalanceDialog'
import { FinanceHeader } from '../../components/finance/FinanceHeader'
import { Button } from '../../components/ui'

/**
 * Finance → Balance & budget.
 *
 * A route rather than a panel on the payments screen, and rather than a third tab on the
 * grants card — see `FinanceHeader` for why. Finance is now two routes wearing one header,
 * the same shape Shortlist uses, so the tabs stay honestly NAVIGATION while the To pay /
 * Paid pair inside the grants card stays honestly a filter.
 *
 * **Update balance lives here and only here.** It is the screen's own action, sat left of
 * the tabs as Shortlist puts its own. An earlier cut had it in two places at once — a
 * header button and a link inside the balance card — which is two things to keep in step
 * for one job.
 */
export const Route = createFileRoute('/_authenticated/finance/balance')({
  // A foundation that has switched this screen off should not be able to sit on it — the
  // tab is gone, so the only ways here are a stale link or a bookmark, and both should
  // land on the screen Finance actually offers.
  loader: async () => {
    const nav = await getFinanceNav()
    if (!nav.showBalanceAndBudget) throw redirect({ to: '/finance' })
    return { data: await getBalanceAndBudget() }
  },
  component: BalancePage,
})

function BalancePage() {
  const { data } = Route.useLoaderData()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <FinanceHeader
        tab="balance"
        subtitle={data ? `Financial year ${data.financialYear.label}` : undefined}
        showTabs
        actions={
          <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
            {data?.balance ? 'Update balance' : 'Record balance'}
          </Button>
        }
      />

      {data && <BalanceAndBudget data={data} />}

      <BankBalanceDialog
        open={dialogOpen}
        previous={data?.balance ?? null}
        onClose={() => setDialogOpen(false)}
        onSaved={() => router.invalidate()}
      />
    </div>
  )
}
