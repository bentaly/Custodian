import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { Card, ErrorNote, Toggle } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/voting')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ profile: await getClientProfile() }),
  component: Voting,
})

/** The setting's own copy, announced with the switch rather than left beside it. */
const COPY_ID = 'admin-voting-explainer'

function Voting() {
  const { profile } = Route.useLoaderData()
  const [enabled, setEnabled] = useState(profile?.allowAdminVoting ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleToggle(next: boolean) {
    setEnabled(next)
    setSaving(true)
    setError('')
    try {
      await upsertClientProfile({ data: { allowAdminVoting: next } })
    } catch {
      setEnabled(!next) // revert on failure
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage
      title="Voting"
      description="Trustees vote yes or no on shortlisted applications, and a majority is needed before a grant can be awarded."
    >
      <Card className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="font-display text-body font-medium text-grey-900">
            Allow admins to vote on behalf of trustees
          </p>
          <p id={COPY_ID} className="mt-0.5 font-display text-body leading-relaxed text-grey-500">
            When enabled, admins can record yes/no votes for any trustee on an application — useful
            when a trustee sends their decision outside the platform.
          </p>
          <ErrorNote error={error} className="mt-2" />
        </div>
        <Toggle
          checked={enabled}
          onChange={handleToggle}
          busy={saving}
          label="Allow admins to vote on behalf of trustees"
          describedBy={COPY_ID}
        />
      </Card>
    </SettingsPage>
  )
}
