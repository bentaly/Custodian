import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { ErrorNote, Panel, PanelTitle, Toggle } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/shortlisting')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ profile: await getClientProfile() }),
  component: Shortlisting,
})

type SwitchField = 'enforceRoundBudget' | 'allowAdminVoting'

/**
 * The rules an application passes on its way from shortlist to award. They were two
 * pages holding one switch each; both gate the same step, both take effect on the
 * Shortlist and application screens, and a page per switch made the Settings hub read
 * as a list of toggles rather than a map of the foundation. Each saves on the spot, so
 * there is nothing to guard.
 */
function Shortlisting() {
  const { profile } = Route.useLoaderData()

  return (
    <SettingsPage
      title="Shortlisting and voting"
      description="The rules an application passes on its way from the shortlist to an award."
    >
      <Panel label="Round budgets">
        <PanelTitle>Round budgets</PanelTitle>
        <p className="mb-4 font-display text-body leading-relaxed text-grey-500">
          Each programme in a round carries a budget. This is what that figure does when you
          shortlist against it.
        </p>
        {/* Both halves are stated, because the setting has no neutral position: off is
            a policy too, and a switch described only by what turning it on does leaves
            a foundation guessing what it is choosing by leaving it alone. */}
        <SettingSwitch
          field="enforceRoundBudget"
          initial={profile?.enforceRoundBudget ?? false}
          title="Stop shortlisting once a programme’s budget is committed"
          explainer="When enabled, an application that would take a programme past its budget for the round cannot be shortlisted, and the button reads “Budget full”. When off, the budget is a target rather than a limit: you can shortlist beyond it, and the shortlist’s proposed spend says how far over the round has gone."
        />
      </Panel>

      <Panel label="Voting">
        <PanelTitle>Voting</PanelTitle>
        <p className="mb-4 font-display text-body leading-relaxed text-grey-500">
          Trustees vote yes or no on shortlisted applications, and a majority is needed before a
          grant can be awarded.
        </p>
        <SettingSwitch
          field="allowAdminVoting"
          initial={profile?.allowAdminVoting ?? false}
          title="Allow admins to vote on behalf of trustees"
          explainer="When enabled, admins can record yes/no votes for any trustee on an application, which is useful when a trustee sends their decision outside the platform."
        />
      </Panel>
    </SettingsPage>
  )
}

function SettingSwitch({
  field,
  initial,
  title,
  explainer,
}: {
  field: SwitchField
  initial: boolean
  title: string
  explainer: string
}) {
  const [enabled, setEnabled] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The setting's own copy, announced with the switch rather than left beside it.
  const copyId = `${field}-explainer`

  async function handleToggle(next: boolean) {
    setEnabled(next)
    setSaving(true)
    setError('')
    try {
      await upsertClientProfile({ data: { [field]: next } })
    } catch {
      setEnabled(!next) // revert on failure
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-display text-body font-medium text-grey-900">{title}</p>
        <p id={copyId} className="mt-0.5 font-display text-body leading-relaxed text-grey-500">
          {explainer}
        </p>
        <ErrorNote error={error} className="mt-2" />
      </div>
      <Toggle
        checked={enabled}
        onChange={handleToggle}
        busy={saving}
        label={title}
        describedBy={copyId}
      />
    </div>
  )
}
