import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { Card, ErrorNote, Toggle } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/round-budgets')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ profile: await getClientProfile() }),
  component: RoundBudgets,
})

/** The setting's own copy, announced with the switch rather than left beside it. */
const COPY_ID = 'enforce-round-budget-explainer'

function RoundBudgets() {
  const { profile } = Route.useLoaderData()
  const [enabled, setEnabled] = useState(profile?.enforceRoundBudget ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleToggle(next: boolean) {
    setEnabled(next)
    setSaving(true)
    setError('')
    try {
      await upsertClientProfile({ data: { enforceRoundBudget: next } })
    } catch {
      setEnabled(!next) // revert on failure
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage
      title="Round budgets"
      description="Each programme in a round carries a budget. This is what that figure does when you shortlist against it."
    >
      <Card className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="font-display text-body font-medium text-grey-900">
            Stop shortlisting once a programme’s budget is committed
          </p>
          {/* Both halves are stated, because the setting has no neutral position: off is
              a policy too, and a switch described only by what turning it on does leaves
              a foundation guessing what it is choosing by leaving it alone. */}
          <p id={COPY_ID} className="mt-0.5 font-display text-body leading-relaxed text-grey-500">
            When enabled, an application that would take a programme past its budget for the round
            cannot be shortlisted — the button reads “Budget full”. When off, the budget is a target
            rather than a limit: you can shortlist beyond it, and the shortlist’s proposed spend
            says how far over the round has gone.
          </p>
          <ErrorNote error={error} className="mt-2" />
        </div>
        <Toggle
          checked={enabled}
          onChange={handleToggle}
          busy={saving}
          label="Stop shortlisting once a programme’s budget is committed"
          describedBy={COPY_ID}
        />
      </Card>
    </SettingsPage>
  )
}
