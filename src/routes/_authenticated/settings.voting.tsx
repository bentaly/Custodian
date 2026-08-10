import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { Card } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/voting')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ profile: await getClientProfile() }),
  component: Voting,
})

function Voting() {
  const { profile } = Route.useLoaderData()
  const [enabled, setEnabled] = useState(profile?.allowAdminVoting ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleToggle() {
    const next = !enabled
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
      <Card className="flex items-center justify-between p-4">
        <div className="pr-4">
          <p className="text-body font-medium text-gray-700">
            Allow admins to vote on behalf of trustees
          </p>
          <p className="mt-0.5 text-body text-gray-500">
            When enabled, admins can record yes/no votes for any trustee on an application — useful
            when a trustee sends their decision outside the platform.
          </p>
          {error && <p className="mt-1 text-label text-danger">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-gray-900' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </Card>
    </SettingsPage>
  )
}
